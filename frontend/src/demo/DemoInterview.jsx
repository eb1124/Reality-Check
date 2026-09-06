import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRealityCheckSession } from '../realityCheck/index';
import ContinuousConsentGate from '../components/session/ContinuousConsentGate';
import ContinuousSessionIndicator from '../components/session/ContinuousSessionIndicator';
import IntegrityReport from '../components/session/IntegrityReport';

/**
 * Mock interview demo (Phase 7 spec §9). Deliberately minimal: no auth, no
 * candidate database, no video storage — just enough of an "interview" to
 * show Reality Check running continuously alongside it. Imports ONLY the
 * public interface (realityCheck/index.js) — never useContinuousVerification,
 * the challenge engines, MediaPipe, or any other internal.
 */
const QUESTIONS = [
  'Tell me about a project you’re proud of and what made it challenging.',
  'Describe a time you disagreed with a teammate. How did you resolve it?',
  'Where do you want to be in your career three years from now?'
];

const DEMO_STAGE = {
  CONSENT: 'CONSENT',
  INTERVIEW: 'INTERVIEW',
  ENDED: 'ENDED'
};

export default function DemoInterview() {
  const [stage, setStage] = useState(DEMO_STAGE.CONSENT);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [status, setStatus] = useState({ state: 'IDLE', challengesRun: 0 });
  const [challengeBanner, setChallengeBanner] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  const videoElRef = useRef(null);
  const rcRef = useRef(null);
  const pollRef = useRef(null);

  const handleDeclineConsent = useCallback(() => {
    setError('Continuous monitoring is required to proceed with this mock interview.');
  }, []);

  const handleAcceptConsent = useCallback(async (disableLightChallenge) => {
    setError(null);
    try {
      const rc = createRealityCheckSession({ videoElement: videoElRef.current, disableLightChallenge });
      rcRef.current = rc;

      rc.on('challenge', (c) => {
        if (c.status === 'started') {
          let message;
          if (c.type === 'LIGHT') {
            message = 'Reality Check: please look directly at your screen for a moment.';
          } else if (c.type === 'TURN_HEAD_LEFT') {
            message = 'Reality Check: please turn your head to the LEFT and hold briefly.';
          } else if (c.type === 'TURN_HEAD_RIGHT') {
            message = 'Reality Check: please turn your head to the RIGHT and hold briefly.';
          } else {
            message = 'Reality Check: please move closer to the camera and hold briefly.';
          }
          setChallengeBanner(message);
        } else {
          setChallengeBanner(null);
        }
      });

      rc.on('event', () => {
        // Demo intentionally does not surface raw events in the UI — the
        // report's technical-detail toggle is where that detail belongs,
        // per §9 ("plain, not a dashboard").
      });

      await rc.start();
      setStage(DEMO_STAGE.INTERVIEW);

      // Poll getStatus() for the persistent indicator — the public
      // interface is imperative/pull-based for status, push-based
      // (via .on) for events/challenges.
      pollRef.current = setInterval(() => {
        setStatus(rc.getStatus());
      }, 1000);
    } catch (err) {
      setError(err.message || 'Failed to start Reality Check session.');
    }
  }, []);

  const endInterview = useCallback(async () => {
    if (pollRef.current) clearInterval(pollRef.current);
    const finalReport = await rcRef.current?.end();
    setReport(finalReport);
    setStage(DEMO_STAGE.ENDED);
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      // Best-effort teardown if the page unmounts mid-interview.
      rcRef.current?.end();
    };
  }, []);

  const isLastQuestion = questionIndex === QUESTIONS.length - 1;

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Mock Interview — Reality Check Demo</h1>
      </header>

      <main className="dashboard-main">
        <section className="video-column">
          <div className="video-feed-wrapper">
            <video ref={videoElRef} autoPlay muted playsInline style={{ width: '100%', borderRadius: 8 }} />
          </div>
          {error && <div className="telemetry-alert-box">{error}</div>}
          {challengeBanner && (
            <div className="telemetry-alert-box" role="status">
              {challengeBanner}
            </div>
          )}
        </section>

        <section className="sidebar-column">
          {stage === DEMO_STAGE.CONSENT && (
            <ContinuousConsentGate onAccept={handleAcceptConsent} onDecline={handleDeclineConsent} />
          )}

          {stage === DEMO_STAGE.INTERVIEW && (
            <>
              <ContinuousSessionIndicator state={status.state} challengesRun={status.challengesRun} onEnd={endInterview} />
              <div className="modular-panel slot-active">
                <div className="panel-header">
                  <h4>
                    Question {questionIndex + 1} of {QUESTIONS.length}
                  </h4>
                </div>
                <div className="panel-body">
                  <p className="intro-description">{QUESTIONS[questionIndex]}</p>
                  <div className="result-actions">
                    {!isLastQuestion ? (
                      <button
                        type="button"
                        className="btn btn-primary btn-small"
                        onClick={() => setQuestionIndex((i) => i + 1)}
                      >
                        Next Question
                      </button>
                    ) : (
                      <button type="button" className="btn btn-primary btn-small" onClick={endInterview}>
                        Finish Interview
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {stage === DEMO_STAGE.ENDED && <IntegrityReport report={report} />}
        </section>
      </main>
    </div>
  );
}
