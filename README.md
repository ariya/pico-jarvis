# Pico Jarvis

Requirements:
* Node.js v18 or later.
* [llama.cpp](https://github.com/ggerganov/llama.cpp) running a model, e.g. [Mistral 7B Instruct](https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.1-GGUF) or [Mistral 7B OpenOrca](https://huggingface.co/TheBloke/Mistral-7B-OpenOrca-GGUF).

Run:
```
$ node pico-jarvis
```

and then open `localhost:5000`.

Try the following questions, one after another:

* Which planet is the largest?
* How far is it?
* How about in miles?

and also some other examples:

* Who wrote the Canon of Medicine?
* Who is Elon Musk?
* What is the native language of Mr. Spock?
* Name Indonesia #1 tourist destination
* Which US state starts with G?
* What is the atomic number of Magnesium?
* Is ramen typically eaten in Egypt?
* Who directed the Dark Knight movie?
* Where do we find kangoroo?
* Who is the father of Luke Skywalker?
* In which country Mandarin is spoken?
* What is the longest river in Latin America?
* Who authored the special theory of relativity?
* Which fictional metal is infused into Wolverine body?
* Who sailed with the flagship Santa Maria?
* Name the big desert close to Mongolia
* Which is closer to Singapor: Vietnam or Australia?
* Who is the fictional spy 007?
* Which country is known for IKEA?

If you get an API key for [OpenWeatherMap](https://api.openweathermap.org) and supply it as `OPENWEATHERMAP_API_KEY` environment variable, try to ask the following:

* How is the weather in Jakarta?
* What is the current temperature in Palo Alto?
* Is it currently cloudy in Seattle?