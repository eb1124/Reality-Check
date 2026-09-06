import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRealityCheckSession } from '../realityCheck/index';
import IntegrityReport from '../components/session/IntegrityReport';

/**
 * Phase 9 external-consumer integration proof (NOT a full online-assessment
 * app — see the spec's §12/§13). Unlike demo-interview.html (which imports
 * only the public interface but still lets Reality Check acquire its own
 * camera), this page plays the role of the SEPARATE consuming application:
 * it opens the camera itself, owns a MediaRecorder against that exact
 * stream, and only THEN hands the same MediaStream object to
 * createRealityCheckSession's `mediaStream` option.
 *
 * The one thing this page exists to demonstrate:
 *
 *   ONE getUserMedia() stream
 *     -> this page's own <video> preview + MediaRecorder (recording)
 *     -> Reality Check's continuous verification (via `mediaStream`)
 *
 * running at the same time, with Reality Check never touching the camera's
 * lifecycle: it doesn't call getUserMedia, and it doesn't call
 * track.stop() — this page starts the camera, and this page (not Reality
 * Check) stops it, strictly after Reality Check has already ended.
 */

const STAGE = {
  IDLE: 'IDLE',
  LIVE: 'LIVE',
  ENDED: 'ENDED'
};

function formatClock(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const m = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const s = String(totalSeconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export default function OaIntegrationDemo() {
  const [stage, setStage] = useState(STAGE.IDLE);
  const [error, setError] = useState(null);
  const [rcStatus, setRcStatus] = useState({ state: 'IDLE', challengesRun: 0 });
  const [challengeBanner, setChallengeBanner] = useState(null);
  const [log, setLog] = useState([]);
  const [report, setReport] = useState(null);
  const [recordingUrl, setRecordingUrl] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const videoElRef = useRef(null);
  const cameraStreamRef = useRef(null); // owned by THIS page, never by Reality Check
  const recorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const rcRef = useRef(null);
  const pollRef = useRef(null);
  const clockRef = useRef(null);

  const appendLog = useCallback((line) => {
    setLog((prev) => [...prev.slice(-19), { at: new Date().toISOString(), line }]);
  }, []);

  const startAssessment = useCallback(async () => {
    setError(null);
    try {
      // 1. THIS PAGE acquires the camera — exactly what a real OA's own
      // candidate-recording step would do. Audio is requested because the
      // OA needs it for its recording; Reality Check ignores any audio
      // track entirely (see EngineBridge.jsx/useCamera.js — only the video
      // is ever read).
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      cameraStreamRef.current = stream;
      if (videoElRef.current) {
        videoElRef.current.srcObject = stream;
        await videoElRef.current.play?.().catch(() => {});
      }
      appendLog('Camera acquired by this page (getUserMedia).');

      // 2. THIS PAGE starts recording the exact same stream, independent of
      // Reality Check entirely.
      recordedChunksRef.current = [];
      if (typeof MediaRecorder !== 'undefined') {
        const recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
        };
        recorder.start();
        recorderRef.current = recorder;
        appendLog('MediaRecorder started against the same stream.');
      } else {
        appendLog('MediaRecorder unavailable in this browser — recording step skipped.');
      }

      // 3. THIS PAGE hands that SAME stream to Reality Check. Reality Check
      // will analyze it for liveness/challenges; it will not call
      // getUserMedia and will not stop any of its tracks.
      const rc = createRealityCheckSession({ mediaStream: stream });
      rcRef.current = rc;

      rc.on('challenge', (c) => {
        if (c.status === 'started') {
          const label = c.type === 'LIGHT' ? 'Light Challenge' : c.type === 'TURN_HEAD_LEFT' ? 'Turn head LEFT' : 'Turn head RIGHT';
          setChallengeBanner(`Reality Check challenge: ${label} — please respond now.`);
          appendLog(`Challenge started: ${c.type}`);
        } else {
          setChallengeBanner(null);
          appendLog(`Challenge ${c.status}: ${c.type}`);
        }
      });
      rc.on('event', (e) => appendLog(`Event: ${e.eventType} (${e.severity})`));

      const { sessionId } = await rc.start();
      appendLog(`Reality Check session started: ${sessionId ?? '(none)'}`);

      clockRef.current = Date.now();
      setElapsedMs(0);
      setStage(STAGE.LIVE);

      pollRef.current = setInterval(() => {
        setRcStatus(rc.getStatus());
        setElapsedMs(Date.now() - clockRef.current);
      }, 1000);
    } catch (err) {
      setError(err.message || 'Failed to start the integration demo.');
    }
  }, [appendLog]);

  const endAssessment = useCallback(async () => {
    if (pollRef.current) clearInterval(pollRef.current);

    // 4. Candidate answers/assessment submission would happen here, in a
    // real OA, before Reality Check is ended — see INTEGRATION.md's
    // end-of-assessment ordering.
    const finalReport = await rcRef.current?.end();
    appendLog('Reality Check session ended; final report received.');
    setReport(finalReport);

    // 5. THIS PAGE stops its own recording, independently of Reality Check.
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      await new Promise((resolve) => {
        recorderRef.current.onstop = resolve;
        recorderRef.current.stop();
      });
    }
    if (recordedChunksRef.current.length > 0) {
      const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
      setRecordingUrl(URL.createObjectURL(blob));
    }
    appendLog('Recording stopped by this page.');

    // 6. THIS PAGE — not Reality Check — releases the camera, and only now.
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    appendLog('Camera released by this page.');

    setStage(STAGE.ENDED);
  }, [appendLog]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      rcRef.current?.end();
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>External Consumer Integration Demo (Phase 9)</h1>
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

          <div className="modular-panel slot-active" style={{ marginTop: 16 }}>
            <div className="panel-header">
              <h4>Ownership ledger</h4>
            </div>
            <div className="panel-body">
              <p className="intro-description">
                This page opened the camera and owns the MediaRecorder. Reality Check was handed the
                same MediaStream and never called getUserMedia or stopped a track — this list is the
                live evidence trail.
              </p>
              <div className="telemetry-data-table">
                {log.map((entry, i) => (
                  <div className="telemetry-data-row" key={i}>
                    <span className="data-key font-mono">{entry.at.split('T')[1]?.replace('Z', '')}</span>
                    <span className="data-val">{entry.line}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="sidebar-column">
          {stage === STAGE.IDLE && (
            <div className="modular-panel slot-active">
              <div className="panel-header">
                <h4>Start</h4>
              </div>
              <div className="panel-body">
                <p className="intro-description">
                  Acquires the camera, starts recording it, and hands that same stream to Reality
                  Check for continuous liveness monitoring — the shared-camera contract this phase
                  exists to prove.
                </p>
                <button type="button" className="btn btn-primary btn-small" onClick={startAssessment}>
                  Start Assessment
                </button>
              </div>
            </div>
          )}

          {stage === STAGE.LIVE && (
            <div className="modular-panel slot-active">
              <div className="panel-header">
                <h4>Assessment in progress</h4>
              </div>
              <div className="panel-body">
                <div className="result-metrics-row">
                  <span className="metric-label">Elapsed:</span>
                  <span className="metric-value font-mono">{formatClock(elapsedMs)}</span>
                </div>
                <div className="result-metrics-row">
                  <span className="metric-label">Reality Check state:</span>
                  <span className="metric-value font-mono">{rcStatus.state}</span>
                </div>
                <div className="result-metrics-row">
                  <span className="metric-label">Challenges run:</span>
                  <span className="metric-value font-mono">{rcStatus.challengesRun}</span>
                </div>
                <p className="intro-description" style={{ marginTop: 12 }}>
                  In a real OA, the candidate would be answering questions here. This demo has none —
                  the point is the camera/recording/Reality Check timeline, not the assessment UI.
                </p>
                <div className="result-actions">
                  <button type="button" className="btn btn-primary btn-small" onClick={endAssessment}>
                    Submit &amp; End Assessment
                  </button>
                </div>
              </div>
            </div>
          )}

          {stage === STAGE.ENDED && (
            <>
              <IntegrityReport report={report} />
              {recordingUrl && (
                <div className="modular-panel slot-active" style={{ marginTop: 16 }}>
                  <div className="panel-header">
                    <h4>Recorded video (this page's MediaRecorder)</h4>
                  </div>
                  <div className="panel-body">
                    <video src={recordingUrl} controls style={{ width: '100%', borderRadius: 8 }} />
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
