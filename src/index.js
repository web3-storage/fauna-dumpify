import { pipeline } from 'stream/promises'
import faunadb from 'faunadb'
import dotenv from 'dotenv'
import retry from 'p-retry'
import path from 'path'
import ora from 'ora'
import fs from 'fs'

dotenv.config()
const q = faunadb.query

const findAllCollections = async (client) =>
  (await client.query(q.Paginate(q.Collections()))).data

async function * fetchAllDocuments ({ client, endtime, pageSize, collection, lambda }) {
  let after
  do {
    const page = await retry(
      () =>
        client.query(
          q.At(
            q.Time(endtime),
            q.Map(
              q.Paginate(q.Documents(collection), {
                size: pageSize,
                after
              }),
              lambda(q, collection.value.id)
            )
          )
        ),
      { forever: true }
    )

    after = page.after
    yield page
  } while (after)
}

async function faunaDump (faunaKey, outputPath, overrideOptions) {
  const options = {
    endPointInTime: new Date(),
    collections: [],
    pageSize: 1000,
    headerTransformer: (header) => header,
    dataTransformer: (header, data) => data[header],
    appendData: (_, data) => data,
    filenameTransformer: (name) => name,
    // Should return an object with collection and relations properties, which will be flatted
    faunaLambda: (q, collection) => q.Lambda(['ref'], q.Let({
      collection: q.Get(q.Var('ref'))
    }, {
      collection: q.Var('collection'),
      relations: {}
    })),
    ...overrideOptions
  }

  const client = new faunadb.Client({ secret: faunaKey })
  console.time('⏱')
  const spinner = ora('Dumping Fauna Data').start()

  if (!fs.existsSync(outputPath)) {
    spinner.start(`➕ Creating directory ${outputPath}`)
    fs.mkdirSync(outputPath)
    spinner.stopAndPersist({
      symbol: '➕',
      text: `Created ${outputPath} directory`
    })
  }

  const collections = await findAllCollections(client)
  const endtime = options.endPointInTime.toISOString()
  const pageSize = Number.parseInt(options.pageSize)

  spinner.info(`Querying DB snapshot at ${endtime}`)
  spinner.info(`Downloading in batches of ${pageSize}...`)

  const collectionsToPick = options.collections.map((c) => c.toUpperCase())

  for (const collection of collections) {
    if (
      options.collections.length &&
      !collectionsToPick.includes(collection.value.id.toUpperCase())
    ) {
      continue
    }
    let count = 0
    spinner.start(`${collection.value.id} ${count}`)
    await pipeline(
      fetchAllDocuments({ client, endtime, pageSize, collection, lambda: options.faunaLambda }),
      async function * logProgress (source) {
        for await (const page of source) {
          yield page
          count += page.data.length
          spinner.text = `${collection.value.id} ${count} ${
            page?.after ? `after: ${page?.after}` : ''
          }`
        }
      },
      async function * stringify (source) {
        for await (const page of source) {
          const rawData = page.data.map((d) => ({
            id: d.collection.ref.value.id,
            ...d.collection.data,
            ...d.relations
          }))
          const data = options.appendData(collection.value.id, rawData)
          const replacer = (_, value) => (value === null ? '' : value)
          const headers =
            options.headers?.(collection.value.id) ||
            Object.keys(data[0]).map(options.headerTransformer).filter(Boolean)

          yield [
            headers.join(','), // header row first
            ...data.map((row) =>
              headers
                .map((header) =>
                  JSON.stringify(
                    options.dataTransformer(header, row, collection.value.id),
                    replacer
                  )
                )
                .join(',')
            )
          ].join('\r\n')
        }
      },
      fs.createWriteStream(path.join(outputPath, `${options.filenameTransformer(collection.value.id)}.csv`))
    )
    spinner.succeed()
  }
  console.timeEnd('⏱')
}

export default faunaDump
