const fs = require('fs');
const http = require('http');
const { readPdfPages } = require('pdf-text-reader');

const LLAMA_API_URL = process.env.LLAMA_API_URL || 'http://127.0.0.1:8080/completion';

const FEATURE_MODEL = 'Xenova/all-MiniLM-L6-v2';

const OPENWEATHERMAP_API_KEY = process.env.OPENWEATHERMAP_API_KEY;

const llama = async (prompt, attempt = 1) => {
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
    if (response.ok) {
        const data = await response.json();
        const { content } = data;
        return content.trim();
    }
    if (attempt > 3) {
        const message = 'LLM API server does not respond properly!';
        console.error(message);
        return message;
    }
    console.error('LLM API call failure:', response.status, 'Retrying...');
    return await llama(prompt, attempt + 1);
}

const weather = async (location) => {
    const WEATHER_ERROR_MSG = `Unable to retrieve weather information.
    Please supply a valid API key for OpenWeatherMap as OPENWEATHERMAP_API_KEY environment variable.`

    const geocode = async (location) => {
        const url = `http://geocoding-api.open-meteo.com/v1/search?name=${location}&count=1&format=json`
        const response = await fetch(url);
        const { results } = await response.json();
        return results.pop();
    }

    if (!OPENWEATHERMAP_API_KEY || OPENWEATHERMAP_API_KEY.length < 32) {
        throw new Error(WEATHER_ERROR_MSG);
    }
    console.log('WEATHER:');
    console.log(' location:', location);
    const { latitude, longitude } = await geocode(location);
    console.log(' latitude:', latitude);
    console.log(' longitude:', longitude);
    const url = `https://api.openweathermap.org/data/2.5/weather?units=metric&lat=${latitude}&lon=${longitude}&appid=${OPENWEATHERMAP_API_KEY}`
    const response = await fetch(url);
    const data = await response.json();
    const { name, weather, main } = data;
    const { description } = weather[0];
    const { pressure, temp, humidity } = main;
    console.log(' name:', name);
    console.log(' description:', description);
    console.log(' pressure:', pressure);
    console.log(' temp:', temp);
    console.log(' humidity:', humidity);
    const summary = `This is the weather observation for ${name}.
The current weather condition is ${description}.
* barometric pressure: ${pressure} mbars.
* temperature (in Celcius): ${Math.round(temp)} °C.
* temperature (in Fahrenheit): ${Math.round(32 + temp * 9 / 5)} °F.
* humidity: ${humidity}%.`;
    return { summary, description, temp, humidity };
}

const ingest = async (url) => {

    const sequence = (N) => Array.from({ length: N }, (_, i) => i);

    const paginate = (entries, pagination) => entries.map(entry => {
        const { offset } = entry;
        const page = pagination.findIndex(i => i > offset);
        return { page, ...entry };
    });

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

        const result = [];
        for (let index = 0; index < chunks.length; ++index) {
            const { offset } = chunks[index];
            const block = chunks.slice(index, index + 3).map(({ text }) => text).join(' ');
            const sentence = block;
            const output = await extractor([sentence], { pooling: 'mean', normalize: true });
            const vector = output[0].data;
            result.push({ index, offset, sentence, vector });
        }
        return result;
    }


    console.log('INGEST:');
    const input = await readPdfPages({ url });
    console.log(' url:', url);
    const pages = input.map((page, number) => { return { number, content: page.lines.join(' ') } });
    console.log(' page count:', pages.length);
    const pagination = sequence(pages.length).map(k => pages.slice(0, k + 1).reduce((loc, page) => loc + page.content.length, 0))
    const text = pages.map(page => page.content).join(' ');
    const start = Date.now();
    document = paginate(await vectorize(text), pagination);
    const elapsed = Date.now() - start;
    console.log(' vectorization time:', elapsed, 'ms');
    return document;
}

const parse = (text) => {
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

const LOOKUP_PROMPT = `You are an expert in retrieving information.
You are given a {{KIND}}, and then you respond to a question.
Avoid stating your personal opinion. Avoid making other commentary.
Think step by step.

Here is the {{KIND}}:

{{PASSAGES}}

(End of {{KIND}})

Now it is time to use the above {{KIND}} exclusively to answer this.

Question: {{QUESTION}}
Thought: Let us the above reference document to find the answer.
Answer:`;

const answer = async (kind, passages, question) => {
    console.log('ANSWER:');
    console.log(' question:', question);
    console.log('------- passages -------');
    console.log(passages);
    console.log('-------');
    const input = LOOKUP_PROMPT.
        replaceAll('{{KIND}}', kind).
        replace('{{PASSAGES}}', passages).
        replace('{{QUESTION}}', question);
    const output = await llama(input);
    const response = parse(input + output);
    console.log(' answer:', response.answer);
    return response.answer;
}

const lookup = async (document, question, hint) => {

    const encode = async (sentence) => {
        const transformers = await import('@xenova/transformers');
        const { pipeline } = transformers;
        const extractor = await pipeline('feature-extraction', FEATURE_MODEL, { quantized: true });

        const output = await extractor([sentence], { pooling: 'mean', normalize: true });
        const vector = output[0].data;
        return vector;
    }

    const search = async (q, document, top_k = 3) => {
        const { cos_sim } = await import('@xenova/transformers');

        const vector = await encode(q);
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

    const ascending = (x, y) => x - y;
    const dedupe = (numbers) => [...new Set(numbers)];

    const MIN_SCORE = 0.4;

    if (document.length === 0) {
        throw new Error('Document is not indexed!');
    }

    console.log('LOOKUP:');
    console.log(' question:', question);
    console.log(' hint:', hint);

    const candidates = await search(question + ' ' + hint, document);
    const best = candidates.slice(0, 1).shift();
    console.log(' best score:', best.score);
    if (best.score < MIN_SCORE) {
        const FROM_MEMORY = 'From my memory.';
        return { result: hint, source: FROM_MEMORY, reference: FROM_MEMORY };
    }

    const indexes = dedupe(candidates.map(r => r.index)).sort(ascending);
    const relevants = document.filter(({ index }) => indexes.includes(index));
    const passages = relevants.map(({ sentence }) => sentence).join(' ');
    const result = await answer('reference document', passages, question);

    const refs = await search(result || hint, relevants);
    const top = refs.slice(0, 1).pop();
    source = `Best source (page ${top.page + 1}, score ${Math.round(top.score * 100)}%):\n${top.sentence}`;
    console.log(' source:', source);

    return { result, source, reference: passages };
}

const act = async (document, question, action, observation) => {
    const sep = action.indexOf(':');
    const name = action.substring(0, sep);
    const arg = action.substring(sep + 1).trim();

    if (name === 'lookup') {
        const { result, source, reference } = await lookup(document, question, observation);
        return { result, source, reference };
    }

    if (name === 'weather') {
        const condition = await weather(arg);
        const { summary } = condition;
        const result = await answer('weather report', summary, question);
        const reference = `Weather API: ${JSON.stringify(condition)}`;
        return { result, source: summary, reference };
    }

    // fallback to a manual lookup
    console.error('Not recognized action', name, arg);
    return await act(document, question, 'lookup: ' + question, observation);
}

const REASON_PROMPT = `You run in a process of Question, Thought, Action, Observation.

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

{{CONTEXT}}

Now it is your turn to answer the following!

Question: {{QUESTION}}`;

const reason = async (document, history, question) => {

    const capitalize = (str) => str[0].toUpperCase() + str.slice(1);
    const flatten = (parts) => Object.keys(parts).filter(k => parts[k]).map(k => `${capitalize(k)}: ${parts[k]}`).join('\n');

    const HISTORY_MSG = 'Before formulating a thought, consider the following conversation history.';
    const context = (history) => (history.length > 0) ? HISTORY_MSG + '\n\n' + history.map(flatten).join('\n') : '';

    console.log('REASON:');
    console.log(' question:', question);

    const prompt = REASON_PROMPT.replace('{{CONTEXT}}', context(history)).replace('{{QUESTION}}', question);
    const response = await llama(prompt);
    const steps = parse(prompt + response);
    const { thought, action, observation } = steps;
    console.log(' thought:', thought);
    console.log(' action:', action);
    console.log(' observation:', observation);
    console.log(' intermediate answer:', steps.answer);

    const { result, source, reference } = await act(document, question, action ? action : 'lookup: ' + question, observation);
    return { thought, action, observation, answer: result, source, reference };
}

(async () => {
    const document = await ingest('./SolarSystem.pdf');

    let state = {
        history: [],
        source: 'Dunno',
        reference: 'Nothing yet'
    };

    const command = (key, response) => {
        const value = state[key.substring(1)];
        if (value && typeof value === 'string') {
            response.writeHead(200).end(value);
            return true;
        }
        return false;
    }

    const server = http.createServer(async (request, response) => {
        const { url } = request;
        if (url === '/health') {
            response.writeHead(200).end('OK');
        } else if (url === '/' || url === '/index.html') {
            response.writeHead(200, { 'Content-Type': 'text/html' });
            response.end(fs.readFileSync('./index.html'));
        } else if (url.startsWith('/chat')) {
            const parsedUrl = new URL(`http://localhost/${url}`);
            const { search } = parsedUrl;
            const question = decodeURIComponent(search.substring(1));
            if (question === '!reset') {
                state.history.length = 0;
                response.writeHead(200).end('Multi-turn conversation is reset.');
                return;
            }
            if (command(question, response)) {
                return;
            }
            console.log();
            const start = Date.now();
            const { thought, action, observation, answer, source, reference } = await reason(document, state.history, question);
            const elapsed = Date.now() - start;
            state.source = source;
            state.reference = reference;
            response.writeHead(200).end(answer);
            console.log('Responded in', elapsed, 'ms');
            state.history.push({ question, thought, action, observation, answer });
            while (state.history.length > 3) {
                state.history.shift();
            }
        } else {
            console.error(`${url} is 404!`)
            response.writeHead(404);
            response.end();
        }
    });

    const port = process.env.PORT || 5000;
    console.log('SERVER:');
    console.log(' port:', port);
    server.listen(port);
})();
