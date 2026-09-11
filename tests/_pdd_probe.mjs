import { readFileSync } from 'node:fs';
import { signPddDdk, unixSeconds } from '../server/utils/sign.js';
import { httpJson } from '../server/utils/http.js';

const env = {};
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const i = line.indexOf('=');
  if (i > 0 && !line.startsWith('#')) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}
const clientId = env.PDD_CLIENT_ID;
const clientSecret = env.PDD_CLIENT_SECRET;

for (const variant of [
  { label: "page_size:'10'", params: { page_size: '10' } },
  { label: 'page_size:10', params: { page_size: 10 } },
  { label: "pageSize:'10'", params: { pageSize: '10' } },
]) {
  const params = {
    type: 'pdd.ddk.goods.search',
    client_id: clientId,
    timestamp: unixSeconds(),
    data_type: 'JSON',
    keyword: '手机',
    page: '1',
    ...variant.params,
  };
  if (env.PDD_PID) params.pid = env.PDD_PID;
  params.sign = signPddDdk(params, clientSecret);
  try {
    const r = await httpJson('https://gw-api.pinduoduo.com/api/router', {
      method: 'POST',
      form: params,
      timeout: 8000,
    });
    console.log(variant.label, '=>', JSON.stringify(r).slice(0, 300));
  } catch (e) {
    console.log(variant.label, '=> ERR', e.message?.slice(0, 200));
  }
}
