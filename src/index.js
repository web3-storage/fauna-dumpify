import { pipeline } from 'stream/promises'
import faunadb from 'faunadb'
import dotenv from 'dotenv'
import retry from 'p-retry'
import path from 'path'
import fs from 'fs'

dotenv.config()
const q = faunadb.query

const findAllCollections = async (client) =>
  (await client.query(q.Paginate(q.Collections()))).data

async function * fetchAllDocuments ({
  client,
  startTime,
  endTime,
  collectionIndex,
  pageSize,
  collection,
  lambda
}) {
  let after
  let query
  do {
    if (startTime && collectionIndex) {
      query = q.Map(
        q.Paginate(
          q.Range(
            q.Match(q.Index(collectionIndex)),
            q.Time(startTime),
            q.Time(endTime)
          ),
          {
            size: pageSize,
            after
          }
        ),
        lambda(q, collection.value.id)
      )
    } else {
      query = q.At(
        q.Time(endTime),
        q.Map(
          q.Paginate(q.Documents(collection), {
            size: pageSize,
            after
          }),
          lambda(q, collection.value.id)
        )
      )
    }

    const page = await retry(() => client.query(query), { forever: true, onFailedAttempt: console.error })

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
    onCollectionProgress: () => {},
    // Should return an object with collection and relations properties, which will be flatted
    faunaLambda: (q, collection) =>
      q.Lambda(
        ['ref'],
        q.Let(
          {
            collection: q.Get(q.Var('ref'))
          },
          {
            collection: q.Var('collection'),
            relations: {}
          }
        )
      ),
    ...overrideOptions
  }

  const client = new faunadb.Client({ secret: faunaKey })

  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath)
  }

  const collections = await findAllCollections(client)
  const startTime = options.startPointInTime?.toISOString?.()
  const endTime = options.endPointInTime.toISOString()
  const pageSize = Number.parseInt(options.pageSize)

  const collectionsToPick = options.collections.map((c) => c.toUpperCase())

  for (const collection of collections) {
    if (
      options.collections.length &&
      !collectionsToPick.includes(collection.value.id.toUpperCase())
    ) {
      continue
    }
    const collectionIndex = options.collectionIndex(collection.value.id)

    let count = 0

    await pipeline(
      fetchAllDocuments({
        client,
        startTime,
        endTime,
        pageSize,
        collection,
        collectionIndex,
        lambda: options.faunaLambda
      }),
      async function * logProgress (source) {
        for await (const page of source) {
          yield page
          count += page.data.length
          options.onCollectionProgress(`${collection.value.id} ${count} ${
            page?.after ? `after: ${page?.after}` : ''
          }`)
        }
      },
      async function * stringify (source) {
        const headers =
          options.headers?.(collection.value.id) ||
          Object.keys(source[0].data[0])
            .map(options.headerTransformer)
            .filter(Boolean)

        // header row first
        yield `${headers.join(',')}`

        for await (const page of source) {
          const rawData = page.data.map((d) => ({
            id: d.collection.ref.value.id,
            ...d.collection.data,
            ...d.relations
          }))
          const data = options.appendData(collection.value.id, rawData)
          const replacer = (_, value) => (value === null ? '' : value)

          // Yield new line
          if (data.length) {
            yield '\r\n'
          }

          // Yield new documents
          yield [
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
      fs.createWriteStream(
        path.join(
          outputPath,
          `${options.filenameTransformer(collection.value.id)}.csv`
        )
      )
    )
  }
}

export default faunaDump
