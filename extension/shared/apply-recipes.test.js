const assert = require('node:assert/strict');
const test = require('node:test');
const { recipeFor } = require('./apply-recipes.js');

test('Ashby, Greenhouse, and Lever links lead to their application forms', () => {
  assert.deepEqual(recipeFor('https://jobs.ashbyhq.com/camunda/b51b79c6-e2d8-428d-8cdc-0d1aae9792a9?src=LinkedIn'), {
    site: 'ashby',
    formUrl: 'https://jobs.ashbyhq.com/camunda/b51b79c6-e2d8-428d-8cdc-0d1aae9792a9/application',
  });
  assert.equal(
    recipeFor('https://jobs.ashbyhq.com/camunda/b51b79c6-e2d8-428d-8cdc-0d1aae9792a9/application?utm_source=x').formUrl,
    'https://jobs.ashbyhq.com/camunda/b51b79c6-e2d8-428d-8cdc-0d1aae9792a9/application',
  );
  assert.deepEqual(recipeFor('https://job-boards.greenhouse.io/exadelinc/jobs/6229346004?gh_src=4xw8n9y04us'), {
    site: 'greenhouse',
    formUrl: 'https://job-boards.greenhouse.io/exadelinc/jobs/6229346004',
  });
  assert.equal(recipeFor('https://job-boards.eu.greenhouse.io/jetbrains/jobs/4830653101').site, 'greenhouse');
  assert.deepEqual(recipeFor('https://jobs.eu.lever.co/xtb/adf8faf4-bbaa-42d9-af90-d65b18eed659'), {
    site: 'lever',
    formUrl: 'https://jobs.eu.lever.co/xtb/adf8faf4-bbaa-42d9-af90-d65b18eed659/apply',
  });
});

test('account sites and unknown sites are skipped with a reason', () => {
  assert.equal(recipeFor('https://mobility.wd503.myworkdayjobs.com/Mobility/job/Gdansk-POL/Cloud-Engineer_594').site, 'account');
  assert.match(recipeFor('https://fa-extu-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/4169').unsupported, /account/);
  assert.match(recipeFor('https://jobs.elastic.co/jobs/engineering/portugal/x/8125987').unsupported, /does not support/);
  assert.match(recipeFor('not a url').unsupported, /not a valid/);
});
