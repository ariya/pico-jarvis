#!/usr/bin/env node

const { readPdfPages } = require('pdf-text-reader');

const FEATURE_MODEL = 'Xenova/paraphrase-MiniLM-L3-v2';

const isPunctuator = (ch) => (ch === '.') || (ch === '!') || (ch === '?');
const isWhiteSpace = (ch) => (ch === ' ') || (ch === '\n') || (ch === '\t');

const split = (text) => {
    const chunks = [];
    let str = '';
    let offset = 0;
    for (let i = 0; i < text.length; ++i) {
        const ch1 = text[i];
        const ch2 = text[i + 1];
        if (isPunctuator(ch1) && isWhiteSpace(ch2)) {
            str += ch1;
            if (str.slice(-5) !== 'bill.') {
                const text = str.trim();
                chunks.push({ offset, text });
                str = '';
                offset = i + 1;
                continue;
            }
        }
        str += ch1;
    }
    if (str.length > 0) {
        chunks.push({ offset, text: str.trim() });
    }
    return chunks;
}

const vectorize = async (text) => {
    const transformers = await import('@xenova/transformers');
    const { pipeline } = transformers;
    const extractor = await pipeline('feature-extraction', FEATURE_MODEL, { quantized: true });

    const chunks = split(text);

    const start = Date.now();
    const result = [];
    for (let index = 0; index < chunks.length; ++index) {
        const { offset, text } = chunks[index];
        const sentence = text;
        const output = await extractor([sentence], { pooling: 'mean', normalize: true });
        const vector = output[0].data;
        result.push({ index, offset, sentence, vector });
    }
    const elapsed = Date.now() - start;

    if (result.length > 1) console.log('Finished computing the vectors for', result.length, 'sentences in', elapsed, 'ms');

    return result;
}


const TOP_K = 3;

async function search(q, document, top_k = TOP_K) {
    const { cos_sim } = await import('@xenova/transformers');

    const { vector } = (await vectorize(q)).pop();
    const matches = document.map((entry) => {
        const score = cos_sim(vector, entry.vector);
        // console.log(`Line ${entry.index + 1} ${Math.round(100 * score)}%: ${entry.sentence}`);
        return { score, ...entry };
    });

    const relevants = matches.sort((d1, d2) => d2.score - d1.score).slice(0, top_k);
    relevants.forEach(match => {
        const { index, offset, sentence, score } = match;
        // console.log(`  Line ${index + 1} @${offset}, match ${Math.round(100 * score)}%: ${sentence}`)
    });

    return relevants;
}

(async () => {
    const args = process.argv.slice(2);
    if (args.length != 1) {
        console.log('Usage: vector-search "some question"');
        process.exit(-1);
    }
    const query = args[0];

    const input = await readPdfPages({ url: './SolarSystem.pdf' });
    const pages = input.map((p, number) => { return { number, content: p.lines.join(' ') } });
    const text = pages.map(page => page.content).join(' ');
    document = await vectorize(text);

    console.log('The', TOP_K, 'most relevant sentences are:')
    const hits = await search(query, document);
    hits.forEach(match => {
        const { index, sentence, score } = match;
        console.log(` Line ${index + 1}, score ${Math.round(100 * score)}%: ${sentence}`)
    });

})();
