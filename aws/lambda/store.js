/* DynamoDB-backed state for the verify Lambda.
 * One table, partition key "pk" (string), TTL attribute "ttl" (epoch seconds):
 *   code#<email>        pending verification: salt, hash, expires, attempts, lastSent, sends[]
 *   rl#<ip>#<window>    per-IP request counter for the current 15-minute window
 * DynamoDB deletes expired items on its own (TTL), typically within a day or so — the code
 * therefore also checks `expires` itself rather than relying on the item having vanished. */
'use strict';
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

function createDynamoStore({ tableName, client }) {
  const doc = DynamoDBDocumentClient.from(client || new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const codeKey = (email) => ({ pk: `code#${email}` });

  return {
    /** Increment and return this window's request count for a rate-limit key. */
    async hit(key, expiresAtSec) {
      const r = await doc.send(new UpdateCommand({
        TableName: tableName,
        Key: { pk: key },
        UpdateExpression: 'ADD #h :one SET #t = if_not_exists(#t, :t)',
        ExpressionAttributeNames: { '#h': 'hits', '#t': 'ttl' },
        ExpressionAttributeValues: { ':one': 1, ':t': expiresAtSec },
        ReturnValues: 'UPDATED_NEW',
      }));
      return r.Attributes.hits;
    },

    async getPending(email) {
      const r = await doc.send(new GetCommand({ TableName: tableName, Key: codeKey(email), ConsistentRead: true }));
      return r.Item || null;
    },

    async putPending(email, entry) {
      // Keep the record for an hour past the last send so the "5 codes per hour" limit holds.
      const ttl = Math.floor(entry.lastSent / 1000) + 3600 + 60;
      await doc.send(new PutCommand({ TableName: tableName, Item: { ...codeKey(email), ...entry, ttl } }));
    },

    /** Atomically add 1 to attempts and return the updated item, or null if there is none. */
    async bumpAttempts(email) {
      try {
        const r = await doc.send(new UpdateCommand({
          TableName: tableName,
          Key: codeKey(email),
          UpdateExpression: 'ADD #a :one',
          ConditionExpression: 'attribute_exists(#pk)',
          ExpressionAttributeNames: { '#a': 'attempts', '#pk': 'pk' },
          ExpressionAttributeValues: { ':one': 1 },
          ReturnValues: 'ALL_NEW',
        }));
        return r.Attributes;
      } catch (err) {
        if (err && err.name === 'ConditionalCheckFailedException') return null;
        throw err;
      }
    },

    async deletePending(email) {
      await doc.send(new DeleteCommand({ TableName: tableName, Key: codeKey(email) }));
    },
  };
}

module.exports = { createDynamoStore };
