const fs = require('fs');
const http = require('http');
const { readPdfPages } = require('pdf-text-reader');

const LLAMA_API_URL = process.env.LLAMA_API_URL || 'http://127.0.0.1:8080/completion';

const FEATURE_MODEL = 'Xenova/paraphrase-MiniLM-L3-v2';

const OPENWEATHERMAP_API_KEY = process.env.OPENWEATHERMAP_API_KEY;


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
        const { offset } = chunks[index];
        const block = chunks.slice(index, index + 4).map(({ text }) => text).join(' ');
        const sentence = block;
        const output = await extractor([sentence], { pooling: 'mean', normalize: true });
        const vector = output[0].data;
        result.push({ index, offset, sentence, vector });
    }
    const elapsed = Date.now() - start;

    if (result.length > 1) console.log('Finished computing the vectors for', result.length, 'sentences in', elapsed, 'ms');

    return result;
}


const LOOKUP_PROMPT = `You are an expert in retrieving information.
You are given a reference document, and then you respond to a question.
Avoid stating your personal opinion. Avoid making other commentary.
Think step by step.

Here is the reference document:

{{CONTEXT}}

(End of reference document)

Now it is time to use the above document exclusively to answer this.

Question: {{QUESTION}}
Thought: Let us the above reference document to find the answer.
Answer:`;

let document = [];
let reference = 'Nothing yet';
let source = 'Dunno';

async function search(q, document, top_k = 3) {
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

const MIN_SCORE = 0.4;

const ascending = (x, y) => x - y;
const dedupe = (numbers) => [...new Set(numbers)];
const normalize = (str) => str.replace(/[.?]/g, '');

async function lookup(question, hint) {
    if (document.length === 0) {
        throw new Error('Document is not indexed!');
    }

    source = reference = 'From my memory.';

    const candidates = await search(normalize(`${question} ${hint}`), document);
    const best = candidates.slice(0, 1).shift();
    if (best.score < MIN_SCORE) {
        return null;
    }

    const indexes = dedupe(candidates.map(r => r.index)).sort(ascending);
    const relevants = document.filter(({ index }) => indexes.includes(index));
    const context = relevants.map(({ sentence }) => sentence).join(' ');
    console.log();
    console.log('To formulate an answer, here is the context:');
    console.log(context);

    const input = LOOKUP_PROMPT.replace('{{CONTEXT}}', context).replace('{{QUESTION}}', question);
    const output = await llama(input);
    const { answer } = parse(output);

    const refs = await search(normalize(answer || hint), relevants);
    const top = refs.slice(0, 1).pop();

    if (top.score > MIN_SCORE) {
        reference = context;
        source = `Best source (page ${top.page + 1}, score ${Math.round(top.score * 100)}%):\n${top.sentence}`;
    }

    return answer;
}

async function geocode(location) {
    const url = `http://geocoding-api.open-meteo.com/v1/search?name=${location}&count=1&format=json`
    const response = await fetch(url);
    const { results } = await response.json();
    return results.pop();
}

const WEATHER_ERROR_MSG = `Unable to retrieve weather information.
Please supply a valid API key for OpenWeatherMap as OPENWEATHERMAP_API_KEY environment variable.`

async function weather(location) {
    if (!OPENWEATHERMAP_API_KEY || OPENWEATHERMAP_API_KEY.length < 32) {
        throw new Error(WEATHER_ERROR_MSG);
    }
    const { latitude, longitude } = await geocode(location);
    const url = `https://api.openweathermap.org/data/2.5/weather?units=metric&lat=${latitude}&lon=${longitude}&appid=${OPENWEATHERMAP_API_KEY}`
    const response = await fetch(url);
    const data = await response.json();
    const { name, weather, main } = data;
    const { description } = weather[0];
    const { temp, humidity } = main;
    const summary = `The current weather in ${name} is ${description} at ${temp} °C and humidity ${humidity}%`;
    return { summary, description, temp, humidity };
}

async function llama(prompt) {
    const method = 'POST';
    const headers = {
        'Content-Type': 'application/json'
    };
    const stop = ['Llama:', 'User:', 'Question:'];
    const body = JSON.stringify({
        prompt,
        stop,
        n_predict: 200,
        temperature: 0
    });
    const request = { method, headers, body };
    const response = await fetch(LLAMA_API_URL, request);
    const data = await response.json();
    const { content } = data;
    return content.trim();
}

const SYSTEM_MESSAGE = `You run in a process of Question, Thought, Action, Observation.

Think step by step. Always specify the full steps: Thought, Action, Observation, and Answer.

Use Thought to describe your thoughts about the question you have been asked.
For Action, choose exactly one the following:

- weather: location
- lookup: terms

Observation will be the result of running those actions.
Finally at the end, state the Answer in the same language as the original Question.

Here are some sample sessions.

Question: What is capital of france?
Thought: This is about geography, I can recall the answer from my memory.
Action: lookup: capital of France.
Observation: Paris is the capital of France.
Answer: The capital of France is Paris.

Question: How's the temperature in Berlin?
Thought: This is related to weather and I always use weather action.
Action: weather: Berlin
Observation: Cloudy at 17 degrees Celcius.
Answer: 17 degrees Celcius.

Question: Who painted Mona Lisa?
Thought: This is about general knowledge, I can recall the answer from my memory.
Action: lookup: painter of Mona Lisa.
Observation: Mona Lisa was painted by Leonardo da Vinci.
Answer: Leonardo da Vinci painted Mona Lisa.`;

function parse(text) {
    const parts = {};
    const MARKERS = ['Answer', 'Observation', 'Action', 'Thought'];
    const ANCHOR = MARKERS.slice().pop();
    const start = text.lastIndexOf(ANCHOR + ':');
    if (start >= 0) {
        let str = text.substr(start);
        for (let i = 0; i < MARKERS.length; ++i) {
            const marker = MARKERS[i];
            const pos = str.lastIndexOf(marker + ':');
            if (pos >= 0) {
                const substr = str.substr(pos + marker.length + 1).trim();
                const value = substr.split('\n').shift();
                str = str.slice(0, pos);
                const key = marker.toLowerCase();
                parts[key] = value;
            }
        }
    }
    return parts;
}

async function act(question, action, observation, answer) {
    const sep = action.indexOf(':');
    if (sep < 0) {
        console.error('Invalid action', action);
        return null;
    }
    const name = action.substring(0, sep);
    const arg = action.substring(sep + 1).trim();

    if (name === 'lookup') {
        const result = await lookup(question, observation);
        const reobservation = observation;
        const note = result ? result : answer;
        return { reobservation, note };
    }

    if (name === 'weather') {
        const condition = await weather(arg);
        const { summary } = condition;
        source = `Weather API: ${JSON.stringify(condition)}`;
        const reobservation = summary;
        return { reobservation };
    }

    console.error('Not recognized action', name, arg);
}

const capitalize = (str) => str[0].toUpperCase() + str.slice(1);

const flatten = (parts) => Object.keys(parts).filter(k => parts[k]).map(k => `${capitalize(k)}: ${parts[k]}`).join('\n');

const HISTORY_MSG = 'Before formulating a thought, consider the following conversation history.';

const context = (history) => (history.length > 0) ? HISTORY_MSG + '\n\n' + history.map(flatten).join('\n') : '';

async function reason(history, question) {
    const prompt = SYSTEM_MESSAGE + '\n\n' + context(history) + '\n\nNow let us go!\n\n' + 'Question: ' + question;
    const response = await llama(prompt);
    const { thought, action, observation, answer } = parse(prompt + response);
    if (!action) {
        return { thought, action: 'lookup: ' + question, observation, answer };
    }

    const result = await act(question, action, observation, answer);
    if (!result) {
        return { thought, action: 'lookup: ' + question, observation, answer };
    }
    const { reobservation, note } = result;

    const reprompt = prompt + '\n' + flatten({ thought, action, observation: reobservation, answer: note });
    const final = await llama(reprompt);
    return parse(reprompt + final);
}


const history = [];

async function handler(request, response) {
    const { url } = request;
    console.log(`Handling ${url}...`);
    if (url === '/health') {
        response.writeHead(200).end('OK');
    } else if (url === '/' || url === '/index.html') {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(fs.readFileSync('./index.html'));
    } else if (url.startsWith('/chat')) {
        const parsedUrl = new URL(`http://localhost/${url}`);
        const { search } = parsedUrl;
        const question = decodeURIComponent(search.substring(1));
        if (question === '!source') {
            response.writeHead(200).end(source);
            return;
        }
        if (question === '!reference') {
            response.writeHead(200).end(reference);
            return;
        }
        if (question === '!reset') {
            history.length = 0;
            response.writeHead(200).end('Multi-turn conversation is reset.');
            return;
        }
        console.log('Waiting for Llama...');
        while (history.length > 3) {
            history.shift();
        }
        const start = Date.now();
        const { thought, action, observation, answer } = await reason(history, question);
        const elapsed = Date.now() - start;
        console.log('Responded in', elapsed, 'ms');
        history.push({ question, thought, action, observation, answer });
        response.writeHead(200).end(answer);
    } else {
        console.error(`${url} is 404!`)
        response.writeHead(404);
        response.end();
    }
}

const sequence = (N) => Array.from({ length: N }, (_, i) => i);

const paginate = (entries, pagination) => entries.map(entry => {
    const { offset } = entry;
    const page = pagination.findIndex(i => i > offset);
    return { page, ...entry };
});

(async () => {
    console.log('Processing the PDF file. Please wait...');
    const input = await readPdfPages({ url: './SolarSystem.pdf' });
    const pages = input.map((page, number) => { return { number, content: page.lines.join(' ') } });
    const pagination = sequence(pages.length).map(k => pages.slice(0, k + 1).reduce((loc, page) => loc + page.content.length, 0))
    const text = pages.map(page => page.content).join(' ');
    document = paginate(await vectorize(text), pagination);

    http.createServer(handler).listen(5000);
})();
