# Conversation Test Matrix (POC)

This file defines user interaction styles, expected backend intent/mode, and retrieval policy.
Use this as a regression checklist before each deploy.

## Contract
- `mode=list`: return 3-5 schemes
- `mode=focused`: single selected scheme only
- `mode=compare`: exactly 2 schemes
- `mode=clarify`: no scheme list
- `retrieval=blocked`: do not run vector retrieval
- `retrieval=allowed`: vector retrieval allowed

## Core Categories

### 1) Noise / smalltalk
- Style: `lol`, `haha`, `ok`, `hmm`, `great`, `damn`, emoji-only
- Expected: `intent=smalltalk_noise`, `mode=clarify`, `retrieval=blocked`
- Response style: short direction to purpose + what to provide next

### 2) Gibberish / nonsense
- Style: `kusgdfkgfksjgzkshklhlksfg`, `;;;;`, random char bursts
- Expected: `intent=nonsense_noise`, `mode=clarify`, `retrieval=blocked`
- Response style: "I couldn't understand, please write one sentence with state + need"

### 3) Ambiguous acknowledgement
- Style: `yes`, `no`, `sure`, `maybe`, `done`
- Expected: `intent=unclear_ack`, `mode=clarify`, `retrieval=blocked`
- Response style: ask pending question explicitly

### 4) New discovery request (clear)
- Style: `I am a farmer in Maharashtra, income 2 lakh`
- Expected: `intent=new_discovery`, `mode=list`, `retrieval=allowed`
- Response style: relevant schemes + next missing field if needed

### 5) New discovery request (topic-specific)
- Style: `UPSC CSE coaching schemes?`
- Expected: `intent=new_discovery`, `mode=clarify/list`, `retrieval=allowed`
- Response style: targeted follow-up (state/category/income) if profile missing

### 6) Complaint correction
- Style: `I asked Arunachal, why Rajasthan?`
- Expected: `intent=complaint_correction`, `mode=list`, `retrieval=allowed`
- Must: acknowledge error first, clear selected scheme, state-guarded rerank

### 7) Detail request (selected scheme)
- Style: `give documents`, `office address`, `apply link`
- Expected: `intent=detail_request`, `mode=focused`, `retrieval=blocked/optional`
- Must: stay on selected scheme

### 8) Detail request (no scheme specified)
- Style: `give more details`
- Expected: `intent=detail_request`, `mode=clarify`, `retrieval=blocked`
- Must: ask which scheme + show shortlist options

### 9) Compare request
- Style: `compare A vs B`, `which is better between...`
- Expected: `intent=compare_request`, `mode=compare`, `retrieval=blocked/optional`
- Must: side-by-side for exactly two schemes

### 10) Selection request
- Style: `go with first one`, `I choose this scheme`
- Expected: `intent=selection`, `mode=focused`, `retrieval=blocked`
- Must: lock selected scheme in session

### 11) Clarification answers
- Style: `Maharashtra`, `OBC`, `income 1.5 lakh`
- Expected: `intent=clarification_answer`, `mode=clarify/list` based on completion
- Must: update profile memory and ask next missing field

### 12) Language turns
- Style: Hindi, Marathi, Hinglish
- Expected: canonicalize to English internally; respond in requested language
- Must: keep session, intent, and selection behavior unchanged across languages

## High-Risk Edge Cases

1. User gives only profession (`I'm a student`) -> ask state next, not generic boilerplate.
2. User gives only income (`no income`) -> capture as `0`, ask state/profession.
3. User gives age in Hindi (`25 saal`) -> capture age.
4. User uses Hinglish roman text -> still extract profile + intent.
5. User asks details right after complaint -> do not jump to unrelated scheme.
6. User asks `let's go` after prior shortlist -> clarify what action (discover/compare/details).
7. User asks `yes` after bot asks question -> treat as unclear ack unless yes/no question context.
8. User asks unrelated domain (`weather in Delhi`) -> clarify scope: government schemes only.
9. User asks harmful/illegal content -> refuse and redirect.
10. User asks empty/whitespace -> 400 with friendly message.

## Golden Test Utterances (minimum)

### Noise / nonsense
- `lol`
- `haha`
- `...`
- `🔥🔥🔥`
- `kusgdfkgfksjgzkshklhlksfg`

### Discovery
- `I am a 25 year old student in Karnataka, income 1.5 lakh. Any scholarships?`
- `Maharashtra me farmer hu, 2 acre zameen hai`
- `UPSC CSE mains support schemes?`

### Complaint
- `I asked for Arunachal, why are you giving Rajasthan schemes?`

### Focused follow-up
- `Give me documents for this scheme`
- `Where is offline office in Bokaro?`
- `Application link bhejo`

### Compare
- `Compare scheme 1 and scheme 2`
- `Which is better between PMKVY and NULM?`

### Ambiguous ack
- `yes`
- `no`
- `ok`

### Clarification answers
- `Jharkhand`
- `OBC`
- `income 0`
- `age 17`

## Regression Acceptance Rules
- No list output for noise/nonsense/unclear ack.
- Complaint must acknowledge + correct state.
- Focused mode must not list alternatives.
- Compare mode must mention exactly two schemes.
- Session continuity must persist `selectedScheme` and profile fields.
- Language switch must preserve intent and mode behavior.
