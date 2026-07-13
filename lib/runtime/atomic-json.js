'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const writes = new Map();

function writeJsonAtomic(filePath, value) {
  const previous = writes.get(filePath) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await fs.promises.writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
    await fs.promises.rename(temporary, filePath);
  });
  let tracked;
  tracked = operation.finally(() => {
    if (writes.get(filePath) === tracked) writes.delete(filePath);
  });
  writes.set(filePath, tracked);
  return operation;
}

module.exports = { writeJsonAtomic };
