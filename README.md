# mcp-scheduling
> it's actually a router


A framework-agnostic tool router for MCP (Model Context Protocol)
servers. Routes agent requests to the fastest available tool when
similar tools exist, cutting response latency by ~64% (tool
dependent) on average across 824 benchmark questions.
            
Tool similarity is determined by computing vector embeddings of each
tool's description, then grouping duplicates via cosine
similarity. This lets the router identify functionally equivalent
tools automatically.

<div align="center">
  <img width="2124" height="1223" alt="image" src="https://github.com/user-attachments/assets/23571d49-ebab-47d7-a9ff-8bd3d31a7b38" /> 

  <sub>The router is framework agnostic, not dependent on ReAct.</sub>
  <img width="2531" height="1540" alt="image" src="https://github.com/user-attachments/assets/09f85c7e-4d9c-4b9b-9e36-4d43562b757c" />

  <img width="4171" height="5499" alt="image" src="https://github.com/user-attachments/assets/1ca15980-34cf-4b0e-b835-0d26b9bd8215" />
</div>

# Testing Methodology
> [!NOTE]
> Names of the MCP servers/tools are generic when provided to the agent. No mention of slow or fast.

Agent uses `google/gemini-2.0-flash-001` and is provided two MCP servers:

---

`scrape-slow` (5 second delay)
```ts
await new Promise((resolve) => setTimeout(resolve, 5000));
return scrape(url);
```

---

`scrape-fast` (no delay)
```ts
return scrape(url);
```

---

The agent response verifier used `openai/gpt-oss-120b`.

The scheduler was tested against all 824 questions in the [Google Frames Dataset](https://huggingface.co/datasets/google/frames-benchmark). 
```jsonc
[
  {
    "Prompt": "If my future wife has the same first name as the 15th first lady of the United States' mother and her surname is the same as the second assassinated president's mother's maiden name, what is my future wife's name? ",
    "Answer": "Jane Ballou",
    "reasoning_types": "Multiple constraints",
    "wiki_links": ["https://en.wikipedia.org/wiki/President_of_the_United_States", "https://en.wikipedia.org/wiki/James_Buchanan", "https://en.wikipedia.org/wiki/Harriet_Lane", "https://en.wikipedia.org/wiki/List_of_presidents_of_the_United_States_who_died_in_office", "https://en.wikipedia.org/wiki/James_A._Garfield"]
  }, // ...
]
```

# Results

<div align="center">
  <img width="987" height="740" alt="image" src="https://github.com/user-attachments/assets/26f7c5ef-b1eb-4c56-97bb-5c20b190fca7" />
  <sub>Agent using the router was faster by 7112.14 ms (63.53%) on average.</sub>
  <br><br>
  <img width="987" height="740" alt="image" src="https://github.com/user-attachments/assets/e804c5b3-6002-4306-952c-aa48c02db088" />
  <sub>Expected, since the current implementation does not track tool result quality.</sub>
<div align="left">

</div>
</div>

