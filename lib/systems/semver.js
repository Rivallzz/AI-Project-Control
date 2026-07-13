'use strict';

const SEMVER_PATTERN = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parseSemver(value) {
  const raw = String(value || '').trim();
  const match = raw.match(SEMVER_PATTERN);
  if (!match) return null;
  return Object.freeze({
    raw,
    version: `${match[1]}.${match[2]}.${match[3]}${match[4] ? `-${match[4]}` : ''}`,
    major: match[1],
    minor: match[2],
    patch: match[3],
    prerelease: match[4] ? match[4].split('.') : [],
  });
}

function compareIdentifier(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    const leftValue = BigInt(left);
    const rightValue = BigInt(right);
    return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareParsedSemver(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    const comparison = compareIdentifier(left[key], right[key]);
    if (comparison) return comparison;
  }
  if (!left.prerelease.length && !right.prerelease.length) return 0;
  if (!left.prerelease.length) return 1;
  if (!right.prerelease.length) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (left.prerelease[index] === undefined) return -1;
    if (right.prerelease[index] === undefined) return 1;
    const comparison = compareIdentifier(left.prerelease[index], right.prerelease[index]);
    if (comparison) return comparison;
  }
  return 0;
}

function compareSemver(leftValue, rightValue) {
  const left = parseSemver(leftValue);
  const right = parseSemver(rightValue);
  if (!left || !right) return null;
  return compareParsedSemver(left, right);
}

function semverDirection(currentVersion, latestVersion) {
  const comparison = compareSemver(currentVersion, latestVersion);
  if (comparison === null) return 'unknown';
  if (comparison < 0) return 'behind';
  if (comparison > 0) return 'ahead';
  return 'current';
}

function greatestSemver(values) {
  let greatest = null;
  for (const value of values) {
    if (!parseSemver(value)) continue;
    if (greatest === null || compareSemver(value, greatest) > 0) greatest = String(value).trim().replace(/^v/, '');
  }
  return greatest;
}

function extractSemver(value) {
  const matches = String(value || '').match(/v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/g) || [];
  return matches.map((candidate) => candidate.replace(/^v/, '')).find((candidate) => parseSemver(candidate)) || null;
}

module.exports = { parseSemver, compareSemver, semverDirection, greatestSemver, extractSemver };
