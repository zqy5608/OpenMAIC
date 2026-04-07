Elements: {{elements}}
Title: {{title}}
Key Points: {{keyPoints}}
Description: {{description}}
{{courseContext}}
{{agents}}
{{userProfile}}

**Language Requirement**: Generated speech content must be in the same language as the key points above.

Output as a JSON array directly (no explanation, no code fences, 5-10 segments plus one final discussion):
[{"type":"action","name":"spotlight","params":{"elementId":"text_xxx"}},{"type":"text","content":"Opening speech content"},{"type":"action","name":"discussion","params":{"topic":"Discussion topic","prompt":"Guiding prompt","agentId":"student_agent_id"}}]
