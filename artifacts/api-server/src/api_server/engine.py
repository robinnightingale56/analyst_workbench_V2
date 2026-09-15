"""Deterministic evidence assessment and incident-counting rules.

This module intentionally does not infer incidents from metadata-only records.
The rules mirror the former service so saved reviews remain portable.
"""
from __future__ import annotations
import re
from datetime import datetime, timezone
from uuid import uuid4
import spacy
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from spacy.matcher import PhraseMatcher
from .models import Incident, SourceFile

NLP = spacy.blank("en")
NLP.add_pipe("sentencizer")

EVENT_TERMS = r"clash(?:ed|es|ing)?|fight(?:s|ing)?|fought|exchange(?:s|d|ing)? fire|skirmish(?:ed|es|ing)?"
EVENT_RE = re.compile(rf"\b(?:{EVENT_TERMS})\b", re.I)
UNSUPPORTED_BEFORE_EVENT = {
    "could", "expected", "forecast",
    "may", "might", "never", "no", "not", "planned", "plans", "possible",
    "possibly", "potential", "whether", "will", "without", "would",
}

EVALUATION_VECTORS = [
    {"id": "vector-a", "name": "Consumer Indicies", "description": "Stand-in vector measuring changes across selected consumer indicators.", "weight": 0.17, "placeholder": True},
    {"id": "vector-b", "name": "Economic Leverage", "description": "Stand-in vector measuring evidenced economic influence and constraints.", "weight": 0.17, "placeholder": True},
    {"id": "vector-c", "name": "Geo-Strategic", "description": "Stand-in vector measuring geographic and strategic implications.", "weight": 0.17, "placeholder": True},
    {"id": "vector-d", "name": "Subscriber Accounts", "description": "Stand-in vector measuring changes in the scale and quality of subscriber accounts.", "weight": 0.16, "placeholder": True},
    {"id": "vector-e", "name": "Consumer Product Entries", "description": "Stand-in vector measuring the volume and significance of consumer product entries.", "weight": 0.16, "placeholder": True},
    {"id": "vector-f", "name": "Consumer Preferences", "description": "Stand-in vector measuring observable changes in consumer preference.", "weight": 0.17, "placeholder": True},
]
HISTORICAL_RATINGS = [
    {"year": 2022, "rating": "LOW", "score": 42, "summary": "Stand-in history: limited activity and uneven corroboration produced a low baseline rating.", "placeholder": True},
    {"year": 2023, "rating": "MODERATE", "score": 55, "summary": "Stand-in history: broader reporting and improved indicators supported an increase.", "placeholder": True},
    {"year": 2024, "rating": "MODERATE", "score": 59, "summary": "Stand-in history: the rating remained moderate as growth indicators were offset by sustainment gaps.", "placeholder": True},
    {"year": 2025, "rating": "MODERATE", "score": 63, "summary": "Stand-in history: several indicators strengthened, but the scenario did not support the next rating band.", "placeholder": True},
]
STANDARDS = [
    ("source-quality", "Source Quality", "Properly describes the quality and credibility of underlying sources", "Are source quality, credibility, access, and possible bias clearly described?"),
    ("uncertainty", "Uncertainty", "Properly expresses and explains uncertainties associated with major analytic judgments", "Are confidence and uncertainty stated and tied to the evidence?"),
    ("distinctions", "Fact vs. Judgment", "Properly distinguishes between underlying intelligence and analysts' assumptions and judgments", "Can the reader distinguish reporting, assumptions, and analytic judgment?"),
    ("alternatives", "Alternatives", "Incorporates analysis of alternatives", "Were plausible competing explanations or outcomes considered?"),
    ("relevance", "Customer Relevance", "Demonstrates customer relevance and addresses implications", "Does the assessment answer the intelligence question and explain implications?"),
    ("argumentation", "Logical Argument", "Uses clear and logical argumentation", "Do judgments follow from cited evidence through a clear line of reasoning?"),
    ("change", "Change or Consistency", "Explains change to or consistency of analytic judgments", "Are changes from previous judgments, or reasons for consistency, explained?"),
    ("accuracy", "Accuracy", "Makes accurate judgments and assessments", "Are claims bounded, internally consistent, and supported by the selected evidence?"),
    ("visuals", "Effective Visuals", "Incorporates effective visual information where appropriate", "Would a timeline, map, table, or relationship view improve comprehension?"),
]


def _terms(text: str, parties: list[str]) -> set[str]:
    ignored = {
        "clash", "clashed", "clashes", "exchange", "exchanged", "fire",
        "country", "september", "october", "november", "december",
        *(word.lower() for party in parties for word in re.split(r"[^a-z0-9]+", party)),
    }
    return {x for x in re.split(r"[^a-z0-9]+", text.lower()) if len(x) > 3 and x not in ignored}


def _date(text: str) -> str | None:
    match = re.search(
        r"\b(?:on\s+)?(\d{1,2}\s+[A-Z][a-z]+\s+\d{4}|[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})\b",
        text,
    )
    if not match:
        return None
    value = match.group(1).replace(",", "")
    for fmt in ("%d %B %Y", "%B %d %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
        except ValueError:
            pass
    return None


def _location(text: str) -> str:
    doc = NLP.make_doc(text)
    stop_words = {"on", "after", "before", "where", "when", "border"}
    for index, token in enumerate(doc):
        if token.lower_ not in {"in", "near", "at", "along"}:
            continue
        start = index + 1
        if start < len(doc) and doc[start].lower_ == "the":
            start += 1
        end = start
        while end < len(doc):
            candidate = doc[end]
            if candidate.is_punct or candidate.lower_ in stop_words:
                break
            if end > start and candidate.is_space:
                break
            end += 1
        location = doc[start:end].text.strip()
        if location and any(token.is_title or token.is_upper for token in doc[start:end]):
            return location

    match = re.search(
        r"\b(?:in|near|at|along)\s+(?:the\s+)?([A-Z][A-Za-z0-9' -]{2,60}?)(?=[,.;]|\s+(?:on|after|before|where|when|border)\b)",
        text,
    )
    return match.group(1).strip() if match else "Location not established"


def _nlp_links_parties(sentence: str, parties: list[str]) -> bool:
    if len(parties) != 2 or any(not party.strip() for party in parties):
        return False
    doc = NLP(sentence)
    matcher = PhraseMatcher(NLP.vocab, attr="LOWER")
    matcher.add(
        "REQUESTED_PARTIES",
        [NLP.make_doc(party.strip()) for party in parties],
    )
    matched_text = {doc[start:end].text.lower() for _, start, end in matcher(doc)}
    return all(party.strip().lower() in matched_text for party in parties)


def _event_is_asserted(sentence: str) -> bool:
    doc = NLP(sentence)
    for match in EVENT_RE.finditer(sentence):
        event_span = doc.char_span(
            match.start(),
            match.end(),
            alignment_mode="expand",
        )
        if event_span is None:
            continue
        prefix = sentence[:match.start()]
        if re.search(r"^\s*(?:if|had)\b", prefix, re.I):
            continue
        if re.search(
            r"\bno\s+(?:credible\s+)?(?:evidence|reports?|reporting|confirmation|indication|record)\b",
            prefix,
            re.I,
        ):
            continue
        assertion_clause = re.split(
            r"(?:,\s*but\b|;\s*(?:but|however)\b)",
            prefix,
            flags=re.I,
        )[-1]
        if re.search(r"\b(?:denied|denies|deny)\b", assertion_clause, re.I):
            continue
        preceding = [
            token.lower_
            for token in doc[:event_span.start]
            if not token.is_punct
        ]
        if any(marker in UNSUPPORTED_BEFORE_EVENT for marker in preceding[-6:]):
            continue
        if event_span.start > 0 and doc[event_span.start - 1].lower_ in {"not", "never"}:
            continue
        return True
    return False


def _links_parties(sentence: str, parties: list[str]) -> bool:
    if len(parties) != 2 or any(not p.strip() for p in parties):
        return False
    left, right = (re.escape(p.strip()) for p in parties)
    pairs = ((left, right), (right, left))
    for a, b in pairs:
        patterns = (
            rf"\b{a}\b\s+(?:and|&)\s+\b{b}\b(?:\s+\w+){{0,5}}\s+(?:{EVENT_TERMS})\b",
            rf"\b{a}\b(?:\s+\w+){{0,4}}\s+(?:{EVENT_TERMS})\s+(?:with|against|versus|vs\.?)\s+\b{b}\b",
            rf"(?:{EVENT_TERMS})(?:\s+\w+){{0,5}}\s+between\s+\b{a}\b\s+and\s+\b{b}\b",
        )
        if _nlp_links_parties(sentence, parties) and any(
            re.search(pattern, sentence, re.I) for pattern in patterns
        ):
            return True
    return False


def source_supports_incident(source: SourceFile | dict, incident: Incident | dict) -> bool:
    source = source if isinstance(source, SourceFile) else SourceFile.model_validate(source)
    incident = incident if isinstance(incident, Incident) else Incident.model_validate(incident)
    if source.contentDepth == "METADATA":
        return False
    evidence_spans = [
        span for span in incident.evidenceSpans if span.sourceFileId == source.id
    ]
    candidate_texts: list[str] = []
    if evidence_spans:
        for span in evidence_spans:
            if (
                span.endChar <= len(source.content)
                and span.startChar < span.endChar
                and source.content[span.startChar:span.endChar] == span.text
            ):
                candidate_texts.append(span.text)
    elif incident.description in source.content:
        candidate_texts.append(incident.description)

    for sentence in candidate_texts:
        date = _date(sentence)
        supports_location = incident.location == "Location not established" or incident.location.lower() in sentence.lower()
        if (
            date and date[:10] == incident.date[:10] and EVENT_RE.search(sentence)
            and _event_is_asserted(sentence) and _links_parties(sentence, incident.parties)
            and supports_location
        ):
            return True
    return False


def incident_citation_error(incident: Incident | dict, selected: list[SourceFile | dict],
                            requested_parties: list[str] | None = None,
                            date_range: dict | None = None) -> str | None:
    incident = incident if isinstance(incident, Incident) else Incident.model_validate(incident)
    requested = requested_parties or incident.parties
    if sorted(p.strip().lower() for p in incident.parties) != sorted(p.strip().lower() for p in requested) or any(not p.strip() for p in incident.parties):
        return "Incident parties must match the parties requested in the count question"
    if date_range and not (date_range["startDate"] <= incident.date[:10] <= date_range["endDate"]):
        return "Incident date falls outside the period requested in the count question"
    if not incident.sourceFileIds:
        return "Every included incident requires a citation"
    by_id = {s.id: s for s in (x if isinstance(x, SourceFile) else SourceFile.model_validate(x) for x in selected)}
    for source_id in incident.sourceFileIds:
        source = by_id.get(source_id)
        if source is None:
            return "Incident citations must belong to the selected evidence set"
        if source.contentDepth == "METADATA":
            return "Metadata-only records cannot support a finalized incident"
        if not source_supports_incident(source, incident):
            return "A cited source does not support the incident parties, date, event, and location"
    return None


def _same(left: Incident, right: Incident) -> bool:
    if left.date[:10] != right.date[:10]:
        return False
    l, r = left.location.lower(), right.location.lower()
    known_l, known_r = l != "location not established", r != "location not established"
    if known_l and known_r and l != r:
        return False
    overlap = len(_terms(left.description, left.parties) & _terms(right.description, right.parties))
    denom = max(1, min(len(_terms(left.description, left.parties)), len(_terms(right.description, right.parties))))
    token_similarity = overlap / denom
    try:
        vectors = TfidfVectorizer(
            lowercase=True,
            stop_words="english",
            ngram_range=(1, 2),
        ).fit_transform([left.description, right.description])
        semantic_similarity = float(cosine_similarity(vectors[0], vectors[1])[0, 0])
    except ValueError:
        semantic_similarity = 0.0
    threshold = 0.3 if known_l and known_r else 0.55
    return max(token_similarity, semantic_similarity) >= threshold


def deduplicate_incidents(items: list[Incident | dict]) -> list[dict]:
    result: list[Incident] = []
    for raw in items:
        candidate = raw if isinstance(raw, Incident) else Incident.model_validate(raw)
        duplicate = next((x for x in result if _same(x, candidate)), None)
        if duplicate is None:
            result.append(candidate.model_copy(deep=True))
        else:
            duplicate.sourceFileIds = list(dict.fromkeys(duplicate.sourceFileIds + candidate.sourceFileIds))
            known_spans = {
                (span.sourceFileId, span.startChar, span.endChar)
                for span in duplicate.evidenceSpans
            }
            duplicate.evidenceSpans.extend(
                span
                for span in candidate.evidenceSpans
                if (span.sourceFileId, span.startChar, span.endChar) not in known_spans
            )
            if len(candidate.description) > len(duplicate.description):
                duplicate.description = candidate.description
            if candidate.status == "INCLUDED":
                duplicate.status = "INCLUDED"
    return [x.model_dump() for x in result]


def _parties(question: str) -> list[str] | None:
    patterns = [
        rf"^how many times (?:did|have|has)\s+([a-z][\w .'-]{{1,40}}?)\s+(?:and|with|versus|vs\.?)\s+([a-z][\w .'-]{{1,40}}?)\s+(?:{EVENT_TERMS})\s*[?.]*$",
        rf"^how many times (?:did|have|has)\s+([a-z][\w .'-]{{1,40}}?)\s+(?:{EVENT_TERMS})\s+(?:with|against|versus|vs\.?)\s+([a-z][\w .'-]{{1,40}}?)\s*[?.]*$",
        r"^how many (?:clashes|fights|skirmishes)(?:\s+\w+){0,4}\s+between\s+([a-z][\w .'-]{1,40}?)\s+(?:and|versus|vs\.?)\s+([a-z][\w .'-]{1,40}?)\s*[?.]*$",
        r"^(?:what (?:is|was) )?(?:the )?(?:number|count) of (?:clashes|fights|skirmishes)(?:\s+\w+){0,4}\s+between\s+([a-z][\w .'-]{1,40}?)\s+(?:and|versus|vs\.?)\s+([a-z][\w .'-]{1,40}?)\s*[?.]*$",
    ]
    for pattern in patterns:
        match = re.match(pattern, question, re.I)
        if match:
            return [match.group(1).strip(), match.group(2).strip()]
    return None


def build_count_answer(question: str, selected: list[SourceFile | dict]) -> dict | None:
    sources = [x if isinstance(x, SourceFile) else SourceFile.model_validate(x) for x in selected]
    year = re.search(r"\s+(?:in|during)\s+((?:19|20)\d{2})\s*[?.]*$", question, re.I)
    normalized = question[:year.start()].strip().rstrip("?.") if year else question
    date_range = {"startDate": f"{year.group(1)}-01-01", "endDate": f"{year.group(1)}-12-31"} if year else None
    parties = _parties(normalized)
    if not (re.search(r"\b(how many|number of|count)\b", normalized, re.I) and EVENT_RE.search(normalized) and parties):
        return None
    candidates: list[Incident] = []
    for source in sources:
        if source.contentDepth == "METADATA":
            continue
        for sentence_span in NLP(source.content).sents:
            raw_sentence = sentence_span.text
            sentence = raw_sentence.strip()
            leading_whitespace = len(raw_sentence) - len(raw_sentence.lstrip())
            trailing_whitespace = len(raw_sentence) - len(raw_sentence.rstrip())
            date = _date(sentence)
            if not (EVENT_RE.search(sentence) and _event_is_asserted(sentence) and _links_parties(sentence, parties) and date):
                continue
            if date_range and not date_range["startDate"] <= date[:10] <= date_range["endDate"]:
                continue
            candidates.append(Incident(
                id=str(uuid4()),
                date=date,
                location=_location(sentence),
                parties=parties,
                description=sentence,
                sourceFileIds=[source.id],
                evidenceSpans=[{
                    "sourceFileId": source.id,
                    "text": sentence,
                    "startChar": sentence_span.start_char + leading_whitespace,
                    "endChar": sentence_span.end_char - trailing_whitespace,
                }],
                status="INCLUDED",
            ))
    incidents = deduplicate_incidents(candidates)
    corroborated = sum(len(i["sourceFileIds"]) > 1 for i in incidents)
    confidence = "LOW" if not incidents else ("MODERATE" if corroborated or any(s.reliability == "HIGH" for s in sources) else "LOW")
    return {
        "question": question, "requestedParties": parties, "eventType": "PHYSICAL_CLASH",
        "dateRange": date_range, "provisionalCount": len(incidents), "confidence": confidence,
        "answerStatus": "SUPPORTED" if incidents else "INSUFFICIENT_EVIDENCE",
        "inclusionCriteria": f"Distinct physical clashes or exchanges of fire that name both requested parties and state an event date{' within ' + year.group(1) if year else ''}. Reports with the same event date, compatible location, and substantially overlapping event details are consolidated as one incident.",
        "incidents": incidents, "finalized": False,
    }


def _status(score: int) -> str:
    return "PASS" if score >= 80 else ("REVIEW" if score >= 60 else "GAP")


def assess_sources(selected: list[SourceFile | dict], question: str = "") -> dict:
    sources = [x if isinstance(x, SourceFile) else SourceFile.model_validate(x) for x in selected]
    count = len(sources)
    high = sum(s.reliability == "HIGH" for s in sources)
    types = len({s.sourceType for s in sources})
    relevance = sum(s.relevance for s in sources) / count if count else 0
    scores = [
        min(96, 48 + high * 13 + types * 5), min(88, 54 + count * 4),
        min(92, 58 + count * 5), min(86, 42 + types * 12), round(relevance * 100),
        min(91, 57 + count * 5), 72 if count >= 4 else 49,
        min(94, 50 + high * 11 + round(relevance * 18)), 76 if types >= 3 else 55,
    ]
    findings = [
        f"{high} selected sources are rated high reliability; retain the basis for each rating in the final product." if high >= 2 else "The evidence set needs stronger source-credibility characterization before publication.",
        "Confidence language is not yet tied to specific judgments; add confidence statements and identify the key intelligence gaps.",
        "BLUFs preserve reported facts, but the final synthesis must label assumptions and analytic judgments.",
        "The evidence set supports competing-hypothesis review across multiple source classes." if types >= 3 else "Add a plausible alternative explanation and identify evidence that would confirm or refute it.",
        "The selected reporting is directly responsive to the analyst's stated intelligence question." if relevance >= .8 else "Some selected reporting is only indirectly relevant; tighten the evidence set or explain the linkage.",
        "The evidence can support a clear argument, but each major judgment should link to specific reporting.",
        "No prior assessment is attached. State whether the judgment is new, changed, or consistent with previous analysis.",
        "The evidence base is sufficiently credible for a draft judgment, subject to explicit caveats." if high >= 2 else "Accuracy risk remains elevated because the selected set has limited high-reliability reporting.",
        "A source-comparison matrix or chronology would improve rapid comprehension." if types >= 3 else "A simple evidence table would make source gaps and corroboration easier to review.",
    ]
    standards = [
        {"id": ident, "shortName": short, "name": name, "prompt": prompt, "score": score, "status": _status(score), "finding": findings[i]}
        for i, ((ident, short, name, prompt), score) in enumerate(zip(STANDARDS, scores))
    ]
    overall = round(sum(scores) / len(scores))
    vector_scores = [
        min(94, 45 + count * 7 + types * 3),
        min(96, 42 + high * 14 + round(relevance * 18)),
        min(90, 38 + types * 13), min(88, 44 + high * 9 + count * 4),
        min(93, 40 + types * 8 + round(relevance * 20)), min(91, 43 + count * 5 + round(relevance * 17)),
    ]
    vector_results = []
    for i, vector in enumerate(EVALUATION_VECTORS):
        score = vector_scores[i]
        vector_results.append({
            "id": vector["id"], "name": vector["name"], "weight": vector["weight"], "score": score,
            "status": "STRONG" if score >= 75 else ("MIXED" if score >= 55 else "WEAK"),
            "rationale": (
                f"POC heuristic: source volume, diversity, and assigned reliability produce a strong signal for {vector['name'].lower()}; report content has not yet been machine-evaluated against this vector."
                if score >= 75 else f"POC heuristic: source metadata produces a mixed signal for {vector['name'].lower()}; content-grounded review is still required."
            ),
            "evidenceSourceFileIds": [s.id for j, s in enumerate(sources) if j % len(EVALUATION_VECTORS) <= i][:3] if sources else [],
        })
    current = round(sum(v["score"] * v["weight"] for v in vector_results))
    previous = HISTORICAL_RATINGS[-1]
    delta = current - previous["score"]
    direction = "UP" if delta >= 6 else ("DOWN" if delta <= -6 else "SAME")
    rating = "CRITICAL" if current >= 85 else ("HIGH" if current >= 70 else ("MODERATE" if current >= 45 else "LOW"))
    strongest = max(vector_results, key=lambda x: x["score"])
    weakest = min(vector_results, key=lambda x: x["score"])
    direction_word = {"UP": "increase", "DOWN": "decrease", "SAME": "maintain"}[direction]
    trend = {
        "direction": direction, "previousRating": previous["rating"], "recommendedRating": rating, "confidence": "LOW",
        "rationale": f"Provisional POC signal only: the weighted stand-in-vector metadata score is {current}, compared with the synthetic {previous['year']} baseline of {previous['score']}. The heuristic indicates {direction_word}, but an analyst must review report content and approve or reject this result. {strongest['name']} is the strongest computed driver, while {weakest['name']} is the principal limiting factor.",
        "drivers": [f"{strongest['name']}: {strongest['score']}/100 — strongest evidenced condition.", f"{weakest['name']}: {weakest['score']}/100 — primary uncertainty or collection gap.", f"{high} of {count} selected reports are rated high reliability.", f"{types} distinct source classes contribute to the current assessment."],
    }
    return {
        "id": str(uuid4()), "selectedSourceFileIds": [s.id for s in sources], "overallScore": overall,
        "summary": "The evidence package is broadly defensible, with focused revisions needed before dissemination." if overall >= 80 else "The evidence package is suitable for continued analysis but contains tradecraft gaps that should be resolved before dissemination.",
        "provisional": True,
        "methodology": "Proof-of-concept heuristic based on source count, source-class diversity, assigned source reliability, and retrieval relevance. It does not yet evaluate full report content against the six vectors and must not be treated as a final analytic rating.",
        "standards": standards, "vectorResults": vector_results, "historicalRatings": HISTORICAL_RATINGS,
        "trendAnalysis": trend, "countAnswer": build_count_answer(question, sources),
    }