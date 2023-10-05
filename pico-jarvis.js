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

function createPrompt(input) {
    return `This is a conversation between User and Llama, a friendly chatbot.
Llama is helpful, kind, honest, good at writing, and never fails to answer any requests immediately, with precision, and concisely in 40 words or less.

User: ${input}
Llama:`
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
        const answer = await llama(createPrompt(question));
        console.log('LLama answers:', answer);
        response.writeHead(200).end(answer);
    } else {
        console.error(`${url} is 404!`)
        response.writeHead(404);
        response.end();
    }
}

http.createServer(handler).listen(5000);
