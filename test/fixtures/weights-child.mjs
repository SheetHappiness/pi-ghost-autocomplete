import { prepareWeights } from "../../src/model/weights.ts";
const [cacheRoot, id, manifest] = process.argv.slice(2);
console.log(await prepareWeights({ cacheRoot }, id, JSON.parse(manifest)));
