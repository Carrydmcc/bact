'use strict'

const chalk = require('chalk')

const { buildAppTablesMap } = require('../comparator/tables')
const { cleanup, bulkUpdate, prompt } = require('./helpers')

const SYSTEM_TABLES = ['DeviceRegistration', 'Loggers']

const log = console.log

const removeTableMsg = (app, table) => `Are you sure you want to delete the table ${chalk.bold(`${app}.${table}`)}?`

const updateColumnMsg = (app, table, column, source, target) =>
    `Are you sure you want to update the column ${chalk.bold(`${app}.${table}.${column}`)}: ` +
    `"${target.optionsString}" => "${source.optionsString}"?`

const removeColumnMsg = (app, table, column) =>
    `Are you sure you want to delete the column ${chalk.bold(`${app}.${table}.${column}`)}?`

const errorHandler = (item, err) => {
    if (err.response) {
        err = err.response.data
    }

    console.error(`Error: ${item} - ${err.message}`, err)
}

const syncTables = (api, apps, opts) => {
    log('Schema sync..')

    const getTableNames = tables =>
        tables
            .map(table => table.name)
            .filter(name => !SYSTEM_TABLES.includes(name))

    const [source, ...targets] = apps

    const sourceNames = getTableNames(source.tables)

    const addTable = (appId, tableName) =>
        api.addTable(appId, tableName).catch(err => errorHandler(tableName, err))
    const removeTable = (appId, tableName) =>
        api.removeTable(appId, tableName).catch(err => errorHandler(tableName, err))


    const removeTables = (app, tablesNames) => {
        return tablesNames.reduce((p, tableName) => {
            return p
                .then(() => !opts.silent && prompt(removeTableMsg(app.name, tableName)))
                .then(async res => {
                  if (res || opts.silent) {
                    await removeTable(app.id, tableName)

                    app.tables = app.tables.filter(table => table.name !== tableName)
                  }
                })
        }, Promise.resolve())
    }

    return targets.reduce((p, app) => {
        const targetNames = getTableNames(app.tables)

        const forAdd = sourceNames.filter(name => !targetNames.includes(name))
        const forRemove = targetNames.filter(name => !sourceNames.includes(name))

        p = p.then(() => forRemove.length && removeTables(app, forRemove))

        forAdd.forEach(tableName => {
            p = p.then(() => addTable(app.id, tableName))
        })

        return p
    }, Promise.resolve())
}

const syncColumn = async (api, app, tableName, columnName, sourceColumn, targetColumn, opts) => {
    sourceColumn = sourceColumn && { name: sourceColumn.name || sourceColumn.columnName, ...sourceColumn }
    targetColumn = targetColumn && { name: targetColumn.name || targetColumn.columnName, ...targetColumn }

    const addColumn = () => api.addColumn(app.id, tableName, sourceColumn)

    const updateColumn = async () =>
        Promise.resolve()
            .then(() => opts.silent || prompt(updateColumnMsg(app.name, tableName, columnName, sourceColumn, targetColumn)))
            .then(async res => {
                if (!res) return

                if (sourceColumn.defaultValue != null && sourceColumn.required) {
                    const where = `${columnName} is null`

                    await bulkUpdate(api, app, tableName, where, { [columnName]: sourceColumn.defaultValue })
                }

                sourceColumn.columnId = targetColumn?.columnId

                return api.updateColumn(app, tableName, sourceColumn)
            })

    const removeColumn = () =>
        Promise.resolve()
            .then(() => opts.silent || prompt(removeColumnMsg(app.name, tableName, columnName)))
            .then(res => res && api.removeColumn(app.id, tableName, targetColumn))

    if (sourceColumn && !targetColumn) {
        return addColumn()
    } else if (!sourceColumn && targetColumn) {
        return removeColumn()
    } else if (sourceColumn && targetColumn && targetColumn.optionsString !== sourceColumn.optionsString) {
        return updateColumn()
    }

    return Promise.resolve()
}

const byVirtualColumnsComingLast = (columnsMap, schemaPath) => (columnNameA, columnNameB) => {
    const columnA = columnsMap[columnNameA][schemaPath]
    const columnB = columnsMap[columnNameB][schemaPath]

    // handle cases when some columns are missing as schemas on different envs can be different
    if (!columnA && !columnB) {
        return 0
    } else if (!columnA) {
        return -1
    } else if (!columnB) {
        return 1
    }

    if (columnA.expression && !columnB.expression) {
        return 1
    } else if (!columnA.expression && columnB.expression) {
        return -1
    } else {
        return 0
    }
}

const syncColumns = (api, apps, opts) => {
    const appTablesMap = buildAppTablesMap(apps)
    const [sourceApp, ...targetApps] = apps

    return Object.keys(appTablesMap)
        .filter(tableName => !SYSTEM_TABLES.includes(tableName))
        .reduce((promise, tableName) => {
            const columnsMap = appTablesMap[tableName]
            let columnNamesList = Object.keys(columnsMap)
              .sort(byVirtualColumnsComingLast(columnsMap, sourceApp.name))

            if(tableName === 'Users') {
                const identityColumn = columnNamesList.find(el => columnsMap[el][sourceApp.name].identity)

                columnNamesList = [identityColumn, ...columnNamesList.filter(el => el !== identityColumn)]
            }

            columnNamesList.forEach(columnName => {
                const sourceColumn = columnsMap[columnName][sourceApp.name]

                targetApps.forEach(app => {
                    const targetColumn = columnsMap[columnName][app.name]

                    promise = promise.then(() =>
                        syncColumn(api, app, tableName, columnName, sourceColumn, targetColumn, opts)
                            .catch(err => errorHandler(`${tableName}.${columnName}`, err)))
                })
            })

            return promise
        }, Promise.resolve())
}

module.exports = async (api, apps, opts) => {
  await syncTables(api, apps, opts)
  await api.getAppDataTables()
  await syncColumns(api, apps, opts)
  await cleanup(api, apps)
}