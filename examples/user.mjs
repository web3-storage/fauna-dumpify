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
  dataTransformer: (header, allData, collection) => {
    if (header === 'inserted_at') return allData.created?.value
    if (header === 'updated_at') return allData.created?.value
    return allData[header]
  }
})
