import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const read = mode => JSON.parse(readFileSync(`output/rubber-performance-${mode}.json`, 'utf8'));
const percentile = (values, p) => [...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
const summarize = data => [1,5,10].map(n => {
  const rows = data.samples.filter(row=>row.n===n);
  assert.equal(rows.length,3,`Need three complete batches of ${n}`);
  const batch=rows.map(row=>row.batchMs), acceptance=rows.flatMap(row=>row.acceptanceMs);
  return {n,batches:rows.length,commands:rows.flatMap(row=>row.commandIds).length,
    batchMedianMs:percentile(batch,.5),batchP95Ms:percentile(batch,.95),batchMaxMs:Math.max(...batch),
    acceptanceMedianMs:percentile(acceptance,.5),acceptanceP95Ms:percentile(acceptance,.95),
    businessMedianMs:percentile(rows.flatMap(row=>row.businessMs),.5),
    queueMedianMs:percentile(rows.flatMap(row=>row.queueToCompleteMs),.5),
    commandsPerSecond:n/(percentile(batch,.5)/1000),
    requests:rows.reduce((total,row)=>total+Object.values(row.requests).reduce((a,b)=>a+b,0),0)};
});
const baseline=summarize(read('baseline'));
if(process.argv.includes('--set-gates')) {
  const gates={environment:'Local warm dev UI only; three batches per size, descriptive p95 equals batch maximum',
    baseline,targets:baseline.map(row=>({n:row.n,maxMedianBatchMs:row.batchMedianMs*.8,
      maxP95BatchMs:row.batchP95Ms*.9,maxRequests:row.requests*2})),
    slowAttemptMaxMs:3000,slowCronMaxMs:5000,normalFixtureErrors:0,normalFixtureRetries:0,
    excluded:'Cloud SLA, OCR provider/upload and physical sharing; Local DB-only real-data matrix recorded separately'};
  writeFileSync('output/rubber-performance-gates.json',JSON.stringify(gates,null,2),{flag:'wx'});
  console.log(JSON.stringify(gates));
} else {
  const candidate=summarize(read('candidate'));
  const gates=JSON.parse(readFileSync('output/rubber-performance-gates.json','utf8'));
  const comparison=candidate.map((row,index)=>{
    const target=gates.targets[index], before=baseline[index];
    return {n:row.n,baseline:before,candidate:row,medianReductionPercent:100*(1-row.batchMedianMs/before.batchMedianMs),
      passes:row.batchMedianMs<=target.maxMedianBatchMs&&row.batchP95Ms<=target.maxP95BatchMs&&row.requests<=target.maxRequests};
  });
  const result={comparison,allPassed:comparison.every(row=>row.passes),limitations:gates.environment};
  writeFileSync('output/rubber-performance-comparison.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
  assert.ok(result.allPassed,'Local UI performance gates must pass');
}
