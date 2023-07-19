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

                    options.push(relation.metaInfo.relationIdentificationColumnName)
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

const buildColumnsByNameByTable = tables => {
    return _.mapValues(_.keyBy(tables, 'name'), table => _.keyBy(table.columns, 'name'));
};

const buildRelationsByIdByTable = tables => {
    return _.mapValues(_.keyBy(tables, 'name'), table => _.keyBy(table.relations, 'name'));
};

const buildColumnsById = tables => {
    return _.keyBy(_.flatMap(tables, 'columns'), 'columnId');
};

const getColumnByNameAndTable = (columnsByNameByTable, tableName, columnName) => {
    return columnsByNameByTable[tableName]?.[columnName];
};

const getTargetRelationByIdAndTable = (relationsByIdByTable, tableName, relationName) => {
    return relationsByIdByTable[tableName]?.[relationName] || {};
};

const enrichTargetAppColumnsWithRelationIdentificationNames = (table, targetAppRelationsByIdByTable, targetAppColumnsById) => {
    const relations = table.relations || [];

    if (relations.length) {
        relations.forEach(relation => {
            const { relationIdentificationColumnId } = relation.metaInfo || {};

            if (relationIdentificationColumnId) {
                const targetRelation = getTargetRelationByIdAndTable(
                  targetAppRelationsByIdByTable,
                  relation.fromTableName,
                  relation.name
                );

                if (targetRelation?.metaInfo?.relationIdentificationColumnId) {
                    const relatedColumn = targetAppColumnsById[targetRelation.metaInfo.relationIdentificationColumnId];

                    targetRelation.metaInfo.relationIdentificationColumnName = relatedColumn.name;
                }
            }
        });
    }
}

const enrichSchemaColumnsWithRelationIdentificationIds = (table, targetAppColumnsByNameByTable) => {
    const relations = table.relations || [];

    if (relations.length) {
        relations.forEach(schemaRelation => {
            const { relationIdentificationColumnName } = schemaRelation.metaInfo || {};

            if (relationIdentificationColumnName) {
                const identificationColumn = getColumnByNameAndTable(
                  targetAppColumnsByNameByTable,
                  schemaRelation.toTableName,
                  relationIdentificationColumnName
                );

                if (identificationColumn) {
                    schemaRelation.metaInfo.relationIdentificationColumnId = identificationColumn.columnId;
                }
            }
        });
    }
}

const enrichColumnsWithRelationIdentificationData = (schema, targetApp) => {
    const targetAppColumnsByNameByTable = buildColumnsByNameByTable(targetApp.tables);
    const targetAppRelationsByIdByTable = buildRelationsByIdByTable(targetApp.tables);
    const targetAppColumnsById = buildColumnsById(targetApp.tables);

    schema.tables.forEach(table => enrichSchemaColumnsWithRelationIdentificationIds(table, targetAppColumnsByNameByTable));
    targetApp.tables.forEach(table => enrichTargetAppColumnsWithRelationIdentificationNames(table, targetAppRelationsByIdByTable, targetAppColumnsById));
};

const buildAppTablesMap = apps => {
    enrichColumnsWithRelationIdentificationData(...apps)

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
    const appTablesMap = buildAppTablesMap(apps)

    return printDifferences(apps, appTablesMap);
};

module.exports.buildAppTablesMap = buildAppTablesMap