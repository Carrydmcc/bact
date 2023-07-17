const _ = require('lodash');
const Table = require('cli-table');

const SYSTEM_COLUMNS = ['created', 'updated', 'ownerId', 'objectId', 'blUserLocale']

const buildColumnsMap = table => {
    const result = {}

    table.columns.forEach(column => {
        if (!SYSTEM_COLUMNS.includes(column.name)) {
            const options = [column.dataType]

            column.unique && (options.push('UQ'))
            column.required && (options.push('NN'))
            column.indexed && (options.push('IDX'))
            column.customRegex && (options.push(`REGEXP:${column.customRegex}`))
            column.defaultValue != null && (options.push(`DEFAULT:${column.defaultValue}`))

            column.options = options
            column.optionsString = options.join(', ')

            result[column.name] = column
        }
    })

    const addTableRelations = relations => {
        if (relations) {
            relations.forEach(relation => {
                const column = {
                    columnName: relation.name,
                    toTableName: relation.toTableName,
                    required: relation.required,
                    unique: relation.unique,
                    autoLoad: relation.autoLoad,
                    relationshipType: relation.relationshipType
                }

                const options = [`${relation.toTableName}(${relationTypeAlias(column.relationshipType)})`]
                column.unique && (options.push('UQ'))
                column.required && (options.push('NN'))

                if (relation.metaInfo?.relationIdentificationColumnId) {
                    column.metaInfo || (column.metaInfo = {})
                    column.metaInfo.relationIdentificationColumnId = relation.metaInfo.relationIdentificationColumnId

                    options.push('relationIdentificationColumnId')
                }

                column.options = options
                column.optionsString = options.join(', ')

                result[relation.name] = column
            })
        }
    }

    addTableRelations(table.relations)
    addTableRelations(table.geoRelations)

    return result
}

const relationTypeAlias = relationType => relationType === 'ONE_TO_ONE' ? '1:1' : '1:N'

const containsDifferences = (apps, columnName, columnsMap) => {
    const versions = _.uniqBy(apps, app => {
        const appColumn = columnsMap[columnName][app.name]

        return appColumn ? appColumn.optionsString : ''
    })

    return versions.length > 1
}

const printDifferences = (apps, appTablesMap) => {
    const table = new Table({
        head: ['Table', 'Column', ...apps.map(app => app.name)]
    });

    let result = false;

    Object.keys(appTablesMap).sort().forEach(tableName => {
        const columnsMap = appTablesMap[tableName]

        const columns = Object.keys(columnsMap)
            .filter(columnName => containsDifferences(apps, columnName, columnsMap))

        if (columns.length === 0) {
            return
        }

        result = true;

        table.push([
            tableName,
            columns.join('\n'),
            ...apps.map(app => {
                const appColumnOptions = columnName => {
                    const appColumn = columnsMap[columnName][app.name]

                    return appColumn ? appColumn.optionsString : ''
                }

                return columns.map(appColumnOptions).join('\n')
            })
        ])
    })

    if (result) {
        console.log('\nTable schema:\n' + table.toString())
    }

    return result;
}

const enrichColumnsWithRelationIdentificationData = (sourceApp, targetApp) => {
  const targetAppColumnsByIdByTable = _.mapValues(
    _.keyBy(targetApp.tables, 'name'), table => _.keyBy(table.columns, 'name')
  )

  sourceApp.tables.forEach(table => {
    const relations = table.relations || []

    if (relations.length) {
      relations.forEach(relation => {
        const { relationIdentificationColumnName } = relation.metaInfo || {}

        if (relationIdentificationColumnName) {
          const columnId = targetAppColumnsByIdByTable[relation.toTableName]?.[relationIdentificationColumnName]?.columnId

          if (columnId) {
            relation.metaInfo.relationIdentificationColumnId = columnId

            delete relation.metaInfo.relationIdentificationColumnName
          }
        }
      })
    }
  })
}

const buildAppTablesMap = apps => {

    return apps.reduce((appTablesMap, app) => {
        const tablesMapByName = _.keyBy(app.tables, 'name')

        Object.keys(tablesMapByName).forEach(tableName => {
            appTablesMap[tableName] || (appTablesMap[tableName] = {})

            const columnsMap = buildColumnsMap(tablesMapByName[tableName])

            Object.keys(columnsMap).forEach(columnName => {
                appTablesMap[tableName][columnName] || (appTablesMap[tableName][columnName] = {})
                appTablesMap[tableName][columnName][app.name] = columnsMap[columnName]
            })
        })

        return appTablesMap
    }, {})
}

module.exports = apps => {
    enrichColumnsWithRelationIdentificationData(...apps)

    const appTablesMap = buildAppTablesMap(apps)

    return printDifferences(apps, appTablesMap);
};

module.exports.buildAppTablesMap = buildAppTablesMap