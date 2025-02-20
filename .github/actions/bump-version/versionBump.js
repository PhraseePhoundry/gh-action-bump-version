// test
const { execSync, spawn } = require('child_process');
const { EOL } = require('os');
const semver = require('semver');
const core = require('@actions/core')

const MAJOR_VERSION_WORDING = ['MAJOR VERSION INCREMENT', 'major', 'breaking change'];
const MINOR_VERSION_WORDING = ['MINOR VERSION INCREMENT', 'new feature', 'minor'];
const SET_CUSTOM_VERSION_WORDING = ['SET VERSION NUMBER'];
const TAG_PREFIX = 'v'

const latestVersion = core.getInput('currentTag');
const workspace = process.env.GITHUB_WORKSPACE;

(async () => {
  
  const messages = JSON.parse(core.getInput('commits'));

  // determine the release type - one of custom, major, minor, or patch
  const releaseType = getReleaseType(messages)
  console.log('Version release type:', releaseType);

  const customVersionNumbers = releaseType === 'custom' ? getCustomVersionNumbers(messages) : [];

  // GIT logic
  try {
    // set git user
    await runInWorkspace('git', ['config', 'user.name', `"${process.env.GITHUB_USER || 'Automated Version Bump'}"`]);
    await runInWorkspace('git', [
      'config',
      'user.email',
      `"${process.env.GITHUB_EMAIL || 'ga-bump-version@users.noreply.github.com'}"`
    ]);

    let newVersion;
    if (releaseType === 'custom') {
      const customVersion = getHighestVersionNumber(customVersionNumbers)
      if (!semver.gt(customVersion, latestVersion)) {
        exitFailure('New custom version must be higher than current version')
      }
      newVersion = `${TAG_PREFIX}${customVersion}`
    } else {
      newVersion = `${TAG_PREFIX}${incrementVersionNumber(latestVersion, releaseType)}`;
    }

    console.log(`Current version: ${latestVersion}`)
    console.log(`Version to update to: ${newVersion}`);

    const remoteRepo = `https://${process.env.GITHUB_ACTOR}:${process.env.GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPOSITORY}.git`;
    await runInWorkspace('git', ['tag', newVersion]);
    await runInWorkspace('git', ['push', remoteRepo, '--tags']);
    console.log(`::set-output name=newTag::${newVersion}`);
  } catch (e) {
    logError(e);
    exitFailure('Failed to bump version');
    return;
  }
  exitSuccess('Version bumped!');
})();

function exitSuccess(message) {
  console.info(`✔  success   ${message}`);
  process.exit(0);
}

function exitFailure(message) {
  logError(message);
  process.exit(1);
}

function logError(error) {
  console.error(`✖  fatal     ${error.stack || error}`);
}

function runInWorkspace(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: workspace });
    let isDone = false;
    const errorMessages = [];
    child.on('error', (error) => {
      if (!isDone) {
        isDone = true;
        reject(error);
      }
    });
    child.stderr.on('data', (chunk) => errorMessages.push(chunk));
    child.on('exit', (code) => {
      if (!isDone) {
        if (code === 0) {
          resolve();
        } else {
          reject(`${errorMessages.join('')}${EOL}${command} exited with code ${code}`);
        }
      }
    });
  });
}

function getReleaseType(commitMessages) {
  if (commitMessages === 0) {
    console.log("Couldn't find any commits in this event - incrementing patch version");
    return 'patch';
  }

  console.log('Commit messages:', commitMessages);

  // if wording for SET CUSTOM VERSION found
  if (commitMessages.some((message) => SET_CUSTOM_VERSION_WORDING.some((word) => message.includes(word)))) {
    return 'custom';
  }
  // if wording for MAJOR found
  else if (commitMessages.some((message) => MAJOR_VERSION_WORDING.some((word) => message.includes(word)))) {
    return 'major';
  }
  // if wording for MINOR found
  else if (commitMessages.some((message) => MINOR_VERSION_WORDING.some((word) => message.includes(word)))) {
    return 'minor';
  }
  // default to 'patch' if no keywords found
  return 'patch';
}

// function for getting the highest version number, if multiple custom versions are found
function getHighestVersionNumber(versions) {
  const versionNumbers = versions.map(version => semver.clean(version))

  return versionNumbers.sort(semver.rcompare)[0]
}

function incrementVersionNumber(current, type) {
  if (!(type === 'major' || type === 'minor' || type === 'patch')) {
    exitFailure('incrementVersionNumber: invalid release type received')
  }

  return semver.inc(current, type)
}

function getCustomVersionNumbers(commitMessages) {
  const versionNumbers = [];

  commitMessages.forEach((message) => {
    const matches = message.match(/SET VERSION NUMBER {v?[0-9]+[.][0-9]+[.][0-9]+}/g);
    const versionNumberRegex = new RegExp(/v?[0-9]+[.][0-9]+[.][0-9]+/g);
    if (matches) {
      for (let match of matches) {
        const number = match.match(versionNumberRegex);
        versionNumbers.push(number[0]);
      }
    }
  });
  if (versionNumbers.length === 0) {
    exitFailure('getCustomVersionNumbers: No custom version numbers found');
  }
  return versionNumbers;
}