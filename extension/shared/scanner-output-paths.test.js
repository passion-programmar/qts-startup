const assert = require('node:assert/strict');
const test = require('node:test');
const { artifactName, downloadPath, jobFolder, relativePath } = require('./scanner-output-paths');

test('Scanner output uses manager, account, and timestamped job folders with requested filenames', () => {
  const date = new Date(2026, 9, 15, 19, 2, 44);
  const job = { title: 'Program Coordinator', company: 'Resource Innovations' };
  const account = { name: 'Andrei Victor' };
  const manager = { name: 'Manager Name' };
  const resume = relativePath('Downloads', manager, account, job, date, 'resume');
  const cover = relativePath('Downloads', manager, account, job, date, 'cover_letter');
  const details = relativePath('Downloads', manager, account, job, date, 'job_details');

  assert.equal(
    resume,
    'Downloads/QTS_Startup/Manager Name/Andrei Victor/2026-10-15_19-02-44_Program Coordinator_Resource Innovations/Andrei Victor.pdf'
  );
  assert.equal(
    cover,
    'Downloads/QTS_Startup/Manager Name/Andrei Victor/2026-10-15_19-02-44_Program Coordinator_Resource Innovations/Andrei Victor_Cover_Letter.pdf'
  );
  assert.equal(
    details,
    'Downloads/QTS_Startup/Manager Name/Andrei Victor/2026-10-15_19-02-44_Program Coordinator_Resource Innovations/Program Coordinator_Resource Innovations.txt'
  );
  assert.equal(
    downloadPath(manager, account, job, date, 'resume'),
    'QTS_Startup/Manager Name/Andrei Victor/2026-10-15_19-02-44_Program Coordinator_Resource Innovations/Andrei Victor.pdf'
  );
  assert.equal(jobFolder(job, date), '2026-10-15_19-02-44_Program Coordinator_Resource Innovations');
});

test('Scanner output filenames sanitize unsafe path characters', () => {
  const fileName = artifactName(
    { title: 'QA/DevOps: Lead?', company: 'R&D\\Labs' },
    'job_details',
    { name: 'Andrei Victor' }
  );
  assert.equal(fileName, 'QA_DevOps_ Lead__R&D_Labs.txt');
});
