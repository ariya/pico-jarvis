#!/usr/bin/env node

const EMBEDDING_MODEL = 'Xenova/paraphrase-MiniLM-L3-v2';

(async () => {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.log('Usage: vector-encode "some sentence about something"');
        process.exit(-1);
    }

    const transformers = await import('@xenova/transformers');
    const { pipeline } = transformers;
    const extractor = await pipeline('feature-extraction', EMBEDDING_MODEL, { quantized: true });

    const text = args[0];
    const output = await extractor([text], { pooling: 'mean', normalize: true });
    const embedding = output[0].data;
    console.log({ text, embedding });
})();
