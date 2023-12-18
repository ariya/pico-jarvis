#!/usr/bin/env node

const EMBEDDING_MODEL = 'Xenova/paraphrase-MiniLM-L3-v2';

(async () => {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.log('Usage: vector-sim something another-thing');
        process.exit(-1);
    }

    const transformers = await import('@xenova/transformers');
    const { pipeline, cos_sim } = transformers;
    const extractor = await pipeline('feature-extraction', EMBEDDING_MODEL, { quantized: true });

    const db = {};
    for (const text of args) {
        const output = await extractor([text], { pooling: 'mean', normalize: true });
        const embedding = output[0].data;
        db[text] = embedding;
    }

    if (args.length !== 2) {
        console.log(db);
        process.exit(0);
    }

    const first = args[0];
    const second = args[1];
    console.log('Comparing', first, 'vs', second);
    console.log(cos_sim(db[first], db[second]));
})();