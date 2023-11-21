'use strict'

const chalk = require('chalk')

const BackendlessConsole = require('../libs/backendless-console-api.js')

const util = require('util')
const compareTables = require('../libs/comparator/tables')
const compareTablesPermissions = require('../libs/comparator/tables-permissions')
const compareEndpoints = require('../libs/comparator/endpoints')
const compareEndpointsPermissions = require('../libs/comparator/endpoints-permissions')
const compareCustomApiKeys = require('../libs/comparator/api-keys')
const compareAppPermissions = require('../libs/comparator/app-permissions')
const sync = require('../libs/sync')

const {SCHEMA, API, TABLE_PERMS, ROLE_PERMS, API_PERMS, API_KEYS,} = require('./constants/command-options').CheckList

module.exports = options => {

  const checkList = options.checkList.reduce((o, key) => {
    o[key] = true
    return o
  }, {})

  const {
    username, password, appControl, appsToCheck, dumpPath, reportingDir, beURL,
    timeout, verboseOutput, silent, monitorMode, syncMode, tablesToIgnore, columnsToIgnore = [],
  } = options

  const backendless = new BackendlessConsole(
    username, password, beURL, appControl, appsToCheck, reportingDir, timeout, verboseOutput)

  let apps

  return backendless.getAppMeta()
    .then(() => (checkList[SCHEMA] || checkList[TABLE_PERMS]) && backendless.getAppDataTables(columnsToIgnore))
    .then(() => backendless.getAppRoles())
    .then(() => (checkList[ROLE_PERMS] || checkList[API_PERMS]) && backendless.getAppRolePermissions())
    // .then(() => backendless.getAppDataTableUserPermissions())
    .then(() => checkList[TABLE_PERMS] && backendless.getAppDataTableRolePermissions())
    .then(() => (checkList[API] || checkList[API_PERMS]) && backendless.getAppServices())
    .then(() => checkList[API_PERMS] && backendless.getAppServicesRolePermissions())
    .then(() => checkList[API_KEYS] && backendless.getAppCustomApiKeys())
    .then(() => apps = backendless.getApps())
    .then(() => dumpPath && BackendlessConsole.dump(apps[0], dumpPath, verboseOutput, tablesToIgnore))
    .then(() => {
      if (apps.length > 1) {
        return Promise.resolve()
          .then(() => checkList[SCHEMA] && compareTables(apps, columnsToIgnore))
          .then(hasDifferences => (checkList[ROLE_PERMS] && compareAppPermissions(apps)) || hasDifferences)
          .then(hasDifferences => (checkList[TABLE_PERMS] && compareTablesPermissions(apps)) || hasDifferences)
          .then(hasDifferences => (checkList[API] && compareEndpoints(apps)) || hasDifferences)
          .then(hasDifferences => (checkList[API_PERMS] && compareEndpointsPermissions(apps)) || hasDifferences)
          .then(hasDifferences => (checkList[API_KEYS] && compareCustomApiKeys(apps)) || hasDifferences)
          .then(hasDifferences => {
            if (hasDifferences && syncMode) {
              return sync(backendless, apps, { syncList: checkList, silent, columnsToIgnore })
                .then(() => hasDifferences)
            }

            return hasDifferences
          })
          .then(hasDifferences => {
            if (hasDifferences && monitorMode) {
              throw new Error('Differences detected')
            }
          })
      }
    })
    .catch(err => {
      console.log(util.inspect(err))
      console.log(chalk.bold.red(err))

      throw err
    })
}