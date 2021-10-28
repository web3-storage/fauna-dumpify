# fauna-dumpify

Library responsible for iterating over given collections and write a CSV file per collection on a given path.

Usage API:

```typescript
faunaDump (key: string, outputPath: string, options?: {
  collections?: Array<string>, // defaults to all collections
  headers?: (collection: string) => Array<string>, // allows you to specify which headers to be sent to the csv file
  startPointInTime?: Date, // sets the starting point of what documents to filter, use this with `faunaLambda` for better results
  endPointInTime?: Date, // at what point in time are the results valid
  pageSize?: Number, // how many documents to paginate for performance reasons (default: 1000)
  headerTransformer?: (header: string) => string, // allows you to rename headers
  dataTransformer?: (header, data) => data[header], // allows you to make changes to each row data
  appendData?: (_, data) => data, // appends data to each row data
  faunaLambda?: (faunaQueryBuilder, collection), => faunaQueryBuilder // allows you to modify the fauna query to your own needs
  onCollectionProgress?: (progress) => {} // reports on the progress of each collection fetching process.
}): Promise<string>
```

Example:

```javascript
faunaDump(faunaKey, outputPath, {
  collections: ['Token', 'User'],
  headers: (collection) => {
    if (collection === 'User') {
      return ['id', 'name', 'picture', 'email', 'issuer', 'github', 'public_address', 'inserted_at', 'updated_at']
    }
    return ['id']
  },
  dataTransformer: (header, allData, collection) => {
    if (header === 'inserted_at') return allData.created?.value
    return allData[header]
  }
})
```
