// Temp file for testing the usage as a package
import faunaDump from '../src/index.js'
import dotenv from 'dotenv'
dotenv.config()

const faunaKey = process.env.FAUNA_KEY
const outputPath = 'dist/'

faunaDump(faunaKey, outputPath, {
  collections: ['User'],
  headers: (collection) => {
    if (collection === 'User') {
      return ['id', 'name', 'picture', 'email', 'issuer', 'github', 'public_address', 'inserted_at', 'updated_at']
    }
    return []
  },
  startPointInTime: new Date('2021-10-22T16:04:50.833940Z'),
  collectionIndex: (collection) => 'user_sort_by_created_asc',
  faunaLambda: (q, collection) => q.Lambda(
    collection === 'User' ? ['time', 'ref'] : ['ref'],
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
  dataTransformer: (header, allData, collection) => {
    if (header === 'inserted_at') return allData.created?.value
    if (header === 'updated_at') return allData.created?.value
    return allData[header]
  }
})
