Title: {{title}}
Concept: {{conceptName}}
Description: {{description}}
Design Idea: {{designIdea}}
Key Points: {{keyPoints}}
{{courseContext}}
{{agents}}

**Language Requirement**: Generated speech content must be in the same language as the key points above.

Output as a JSON array directly (no explanation, no code fences, 3-6 speech segments plus one final discussion):
[{"type":"text","content":"Opening speech content"},{"type":"action","name":"discussion","params":{"topic":"Discussion topic","prompt":"Guiding prompt","agentId":"student_agent_id"}}]
