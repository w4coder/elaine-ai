import React from "react";
import type { AskUserQuestion } from "../lib/types";

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface AskUserWidgetProps {
  questions: AskUserQuestion[];
  onSubmit(answers: Array<{ question: string; answer: string }>): void;
  onDismiss(): void;
  /** Called once after TIMEOUT_MS of inactivity (widget visible but unanswered). */
  onTimeout?(): void;
}

export function AskUserWidget({ questions, onSubmit, onDismiss, onTimeout }: AskUserWidgetProps) {
  const total = questions.length;
  const [currentIdx, setCurrentIdx] = React.useState(0);
  // null = unanswered, "__other__" = other/free-text, else the chosen suggestion text
  const [answers, setAnswers] = React.useState<Array<string | null>>(() =>
    questions.map((q) => (q.suggestions?.length ? null : "__other__"))
  );
  const [otherTexts, setOtherTexts] = React.useState<string[]>(() => Array(total).fill(""));
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");

  // Fire onTimeout after 5 minutes if the widget is still mounted and unanswered.
  React.useEffect(() => {
    if (!onTimeout) return;
    const timer = setTimeout(onTimeout, TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [onTimeout]);

  const q = questions[currentIdx];
  const current = answers[currentIdx];
  const isOther = current === "__other__";
  const otherText = otherTexts[currentIdx];
  const isAnswered = current !== null && (!isOther || otherText.trim() !== "");
  const allAnswered = answers.every(
    (a, i) => a !== null && (a !== "__other__" || otherTexts[i].trim() !== "")
  );
  const isLast = currentIdx === total - 1;
  const suggestions = (q.suggestions || []).slice(0, 3);
  const hasSuggestions = suggestions.length > 0;

  function setAnswer(val: string) {
    setAnswers((prev) => prev.map((a, i) => (i === currentIdx ? val : a)));
  }

  function setOtherText(val: string) {
    setOtherTexts((prev) => prev.map((t, i) => (i === currentIdx ? val : t)));
  }

  function goNext() {
    if (isAnswered && !isLast) setCurrentIdx((i) => i + 1);
  }

  function goBack() {
    if (currentIdx > 0) setCurrentIdx((i) => i - 1);
  }

  function submit() {
    if (!allAnswered) {
      setErr("Please answer all questions before submitting.");
      return;
    }
    setErr("");
    setBusy(true);
    const finalAnswers = answers.map((a, i) => ({
      question: questions[i].question,
      answer: a === "__other__" ? otherTexts[i].trim() : (a ?? ""),
    }));
    onSubmit(finalAnswers);
  }

  return (
    <div className="ask-user-widget">
      {/* Header */}
      <div className="ask-user-widget__header">
        <div>
          <div className="ask-user-widget__eyebrow">❓ Agent needs your input</div>
          <div className="ask-user-widget__title">Clarifying Questions</div>
        </div>
        <button
          type="button"
          className="ask-user-widget__dismiss"
          onClick={onDismiss}
          title="Skip — agent continues without answers"
        >
          ×
        </button>
      </div>

      {/* Progress pills */}
      <div className="ask-user-widget__progress">
        <span className="ask-user-widget__progress-count">
          {currentIdx + 1} / {total}
        </span>
        <div className="ask-user-widget__pills">
          {Array.from({ length: total }).map((_, i) => (
            <div
              key={i}
              className={[
                "ask-user-widget__pill",
                i < currentIdx ? "ask-user-widget__pill--done" : "",
                i === currentIdx ? "ask-user-widget__pill--active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            />
          ))}
        </div>
      </div>

      {/* Question */}
      <p className="ask-user-widget__question">{q.question}</p>

      {/* Options */}
      <div className="ask-user-widget__options">
        {hasSuggestions &&
          suggestions.map((s, i) => (
            <label
              key={i}
              className={`ask-user-widget__option${current === s ? " ask-user-widget__option--selected" : ""}`}
            >
              <div className="ask-user-widget__radio">
                {current === s && <div className="ask-user-widget__radio-inner" />}
              </div>
              <span className="ask-user-widget__option-label">{s}</span>
              <input
                type="radio"
                hidden
                readOnly
                checked={current === s}
                onChange={() => setAnswer(s)}
              />
            </label>
          ))}

        {/* Other / free-text row */}
        <label
          className={`ask-user-widget__option${isOther ? " ask-user-widget__option--selected" : ""}`}
          onClick={() => {
            if (!isOther) setAnswer("__other__");
          }}
        >
          <div className="ask-user-widget__radio">
            {isOther && <div className="ask-user-widget__radio-inner" />}
          </div>
          <div className="ask-user-widget__other">
            <span className="ask-user-widget__option-label">
              {hasSuggestions ? "Other" : "Your answer"}
            </span>
            {isOther && (
              <input
                autoFocus
                type="text"
                className="ask-user-widget__other-input"
                placeholder="Type your answer…"
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && isAnswered) {
                    if (!isLast) goNext();
                    else submit();
                  }
                }}
              />
            )}
          </div>
        </label>
      </div>

      {err && <p className="ask-user-widget__err">{err}</p>}

      {/* Footer */}
      <div className="ask-user-widget__footer">
        <button
          type="button"
          className="ask-user-widget__back-btn"
          disabled={currentIdx === 0}
          onClick={goBack}
        >
          ← Back
        </button>

        {isLast ? (
          <button
            type="button"
            className={`ask-user-widget__action-btn${allAnswered && !busy ? " ask-user-widget__action-btn--submit" : ""}`}
            disabled={!allAnswered || busy}
            onClick={submit}
          >
            {busy ? "Submitting…" : "✓ Submit"}
          </button>
        ) : (
          <button
            type="button"
            className={`ask-user-widget__action-btn${isAnswered ? " ask-user-widget__action-btn--next" : ""}`}
            disabled={!isAnswered}
            onClick={goNext}
          >
            Next →
          </button>
        )}
      </div>
    </div>
  );
}
