'use strict';

const Table = require('cli-table');

const printDifferences = (apps, apiKeysMap) => {
  const table = new Table({
    head: ['API Key', ...apps.map(app => app.name)]
  });

  let result = false

  Object.keys(apiKeysMap).sort().forEach(apiKey => {
    const keysByAppName = apiKeysMap[apiKey]

    if (Object.keys(keysByAppName).length > 1) {
      return
    }

    result = true

    table.push([
      apiKey,
      ...apps.map(app => keysByAppName[app.name] ? 'Yes' : 'No')
    ])
  })

  if (result) {
    console.log('\nCustom API Keys:')
    console.log(table.toString())
  }

  return result
};

const buildApiKeysMap = apps => {
  const apiKeysMap = {}

  apps.forEach(app => {
    app.apiKeys.forEach(apiKey => {
      if (!apiKeysMap[apiKey]) {
        apiKeysMap[apiKey] = {}
      }

      apiKeysMap[apiKey][app.name] = apiKey
    })
  })

  return apiKeysMap
}

module.exports = apps => {
  const apiKeysMap = buildApiKeysMap(apps)

  return printDifferences(apps, apiKeysMap)
}