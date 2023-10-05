const fs = require('fs');
const http = require('http');

const LLAMA_API_URL = process.env.LLAMA_API_URL || 'http://127.0.0.1:8080/completion';

async function llama(prompt) {
    const method = 'POST';
    const headers = {
        'Content-Type': 'application/json'
    };
    const body = JSON.stringify({
        prompt: prompt,
        n_predict: 200,
        temperature: 0,
        top_k: 20,
        stop: ["Llama:", "User:"]
    });
    const request = { method, headers, body };
    const response = await fetch(LLAMA_API_URL, request);
    const data = await response.json();
    const { content } = data;
    return content.trim();
}

const SYSTEM_MESSAGE = `You run in a process of Question, Thought, Action, Observation.

Use Thought to describe your thoughts about the question you have been asked.
Observation will be the result of running those actions.
Finally at the end, state the Answer.

Here are some sample sessions.

Question: What is capital of france?
Thought: This is about geography, I can recall the answer from my memory.
Action: lookup: capital of France.
Observation: Paris is the capital of France.
Answer: The capital of France is Paris.

Question: Who painted Mona Lisa?
Thought: This is about general knowledge, I can recall the answer from my memory.
Action: lookup: painter of Mona Lisa.
Observation: Mona Lisa was painted by Leonardo da Vinci .
Answer: Leonardo da Vinci painted Mona Lisa.

Let's go!`;

async function answer(text) {
    const MARKER = 'Answer:';
    const pos = text.lastIndexOf(MARKER);
    if (pos < 0) return "?";
    const answer = text.substr(pos + MARKER.length).trim();
    return answer;
}

async function think(inquiry) {
    const prompt = SYSTEM_MESSAGE + '\n\n' + inquiry;
    const response = await llama(prompt);
    console.log('Response:', response);
    return answer(response);
}

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
        console.log('Waiting for Llama...');
        const answer = await think('Question: ' + question);
        console.log('LLama answers:', answer);
        response.writeHead(200).end(answer);
    } else {
        console.error(`${url} is 404!`)
        response.writeHead(404);
        response.end();
    }
}

http.createServer(handler).listen(5000);
