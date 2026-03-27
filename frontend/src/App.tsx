import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  authenticate,
  connectSocket,
  findMatch,
  getSocket,
} from "./lib/nakama";
import "./App.css";

type MatchDataLike = {
  opCode?: number;
  op_code?: number;
  opcode?: number;
  data?: unknown;
  payload?: unknown;
  [key: string]: unknown;
};

const OPCODE_START = 1;
const OPCODE_UPDATE = 2;
const OPCODE_DONE = 3;
const OPCODE_MOVE = 4;
const OPCODE_REJECTED = 5;
const TICK_RATE = 5;

function App() {
  const [status, setStatus] = useState("Disconnected");
  const [matchId, setMatchId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  /** Always read inside socket callbacks — those close over stale state from connect. */
  const userIdRef = useRef<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const [board, setBoard] = useState<number[]>([]);
  const [marks, setMarks] = useState<Record<string, number>>({});
  const [activePlayer, setActivePlayer] = useState<string | null>(null);
  const [winner, setWinner] = useState<string | null>(null);
  const [winnerPositions, setWinnerPositions] = useState<number[] | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const myMark = useMemo(() => {
    if (!userId) return null;
    const val = marks[userId];
    return typeof val === "number" ? val : null;
  }, [marks, userId]);

  const myMarkChar = useMemo(() => {
    if (myMark === 1) return "X";
    if (myMark === 2) return "O";
    return "-";
  }, [myMark]);

  const isMyTurn = useMemo(() => {
    return Boolean(
      userId && activePlayer && userId === activePlayer && !winner,
    );
  }, [userId, activePlayer, winner]);

  const timerHudLabel = useMemo(() => {
    if (!matchId || winner) return "Timer";
    if (!activePlayer) return "Timer";
    return isMyTurn ? "Your time" : "Their time";
  }, [matchId, winner, activePlayer, isMyTurn]);

  const timerHudValue = useMemo(() => {
    if (!matchId || winner || !activePlayer) return "—";
    return `${remainingSeconds}s`;
  }, [matchId, winner, activePlayer, remainingSeconds]);

  /** Subtle win / loss / draw theming (Victory / Defeat / Draw from server). */
  const outcomeTone = useMemo<"win" | "loss" | "draw" | null>(() => {
    if (!resultMessage) return null;
    if (resultMessage === "Victory") return "win";
    if (resultMessage === "Defeat") return "loss";
    if (resultMessage === "Draw") return "draw";
    return null;
  }, [resultMessage]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    if (!matchId || winner) return;

    const timer = setInterval(() => {
      setRemainingSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(timer);
  }, [matchId, winner]);

  function parsePayload(raw: unknown): unknown | null {
    if (!raw) return null;

    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }

    if (raw instanceof Uint8Array) {
      const text = new TextDecoder("utf-8").decode(raw);
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    if (raw instanceof ArrayBuffer) {
      const text = new TextDecoder("utf-8").decode(new Uint8Array(raw));
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    if (typeof raw === "object") return raw;
    return null;
  }

  const handleMatchData = useCallback((matchData: unknown) => {
    const uid = userIdRef.current;
    const md = matchData as MatchDataLike;
    const op = md?.opCode ?? md?.op_code ?? md?.opcode ?? null;
    const opNum =
      op === null ||
      op === undefined ||
      (typeof op !== "number" && typeof op !== "string")
        ? null
        : Number(op);

    const parsed = parsePayload(md?.data ?? md?.payload ?? md);
    const p =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : null;

    if (opNum === OPCODE_START || opNum === OPCODE_UPDATE) {
      const nextBoard = Array.isArray(p?.board)
        ? (p.board as unknown[]).map((v) => (typeof v === "number" ? v : 0))
        : [];
      setBoard(nextBoard);

      if (opNum === OPCODE_START) {
        const marksRaw = p?.marks;
        const nextMarks =
          marksRaw && typeof marksRaw === "object" && !Array.isArray(marksRaw)
            ? (marksRaw as Record<string, number>)
            : {};
        setMarks(nextMarks);
      }

      const nextActive =
        typeof p?.activePlayer === "string" ? p.activePlayer : null;
      setActivePlayer(nextActive);

      const nextTicks =
        typeof p?.deadlineRemainingTicks === "number"
          ? p.deadlineRemainingTicks
          : 0;
      setRemainingSeconds(Math.max(0, Math.ceil(nextTicks / TICK_RATE)));

      setWinner(null);
      setWinnerPositions(null);
      setResultMessage(null);
      setStatus(
        nextActive && uid && nextActive === uid
          ? "Your turn"
          : "Opponent's turn",
      );
      return;
    }

    if (opNum === OPCODE_DONE) {
      const nextBoard = Array.isArray(p?.board)
        ? (p.board as unknown[]).map((v) => (typeof v === "number" ? v : 0))
        : [];
      setBoard(nextBoard);

      const winnerId = typeof p?.winner === "string" ? p.winner : null;
      //     const reason = typeof p?.reason === "string" ? p.reason : "completed";
      const nextWinnerPositions = Array.isArray(p?.winnerPositions)
        ? (p.winnerPositions as unknown[]).map((v) =>
            typeof v === "number" ? v : 0,
          )
        : null;

      setWinner(winnerId);
      setWinnerPositions(nextWinnerPositions);
      setRemainingSeconds(0);

      if (winnerId && uid && winnerId === uid) {
        setResultMessage("Victory");
        setStatus(`You won `);
      } else if (winnerId) {
        setResultMessage("Defeat");
        setStatus(`You lost`);
      } else {
        setResultMessage("Draw");
        setStatus(`Draw `);
      }
      return;
    }

    if (opNum === OPCODE_REJECTED) {
      const reason = typeof p?.reason === "string" ? p.reason : "invalid move";
      setStatus(`Move rejected: ${reason}`);
    }
  }, []);

  useEffect(() => {
    if (!isConnected) return;
    const sock = getSocket();
    sock.onmatchdata = (matchData: unknown) => {
      handleMatchData(matchData);
    };
    return () => {
      sock.onmatchdata = () => {};
    };
  }, [isConnected, handleMatchData]);

  const handleConnect = async () => {
    try {
      setStatus("Authenticating...");
      const session = await authenticate();
      const id = session.user_id ?? null;
      setUserId(id);
      userIdRef.current = id;

      setStatus("Connecting...");
      await connectSocket();
      setIsConnected(true);
      setStatus("Connected");
    } catch (err) {
      console.error(err);
      setStatus("Connection failed");
    }
  };

  const handleFindMatch = async () => {
    try {
      setStatus("Finding match...");
      setResultMessage(null);
      setBoard([]);
      setMarks({});
      setActivePlayer(null);
      setWinner(null);
      setWinnerPositions(null);
      setRemainingSeconds(0);

      const id = await findMatch();
      setMatchId(id);

      const sock = getSocket();
      await sock.joinMatch(id);
      setStatus("Waiting for opponent...");
    } catch (err) {
      console.error(err);
      setStatus("Matchmaking failed");
    }
  };

  const handleCellClick = async (position: number) => {
    try {
      if (!matchId || !isMyTurn || winner) return;

      const cell = board[position] ?? 0;
      if (cell !== 0) return;

      const sock = getSocket();
      await sock.sendMatchState(
        matchId,
        OPCODE_MOVE,
        JSON.stringify({ position }),
      );
      setStatus("Move sent...");
    } catch (err) {
      console.error(err);
      setStatus("Failed to send move");
    }
  };

  function renderCell(index: number) {
    const cell = board[index] ?? 0;
    const char = cell === 1 ? "X" : cell === 2 ? "O" : "";
    const isWinningCell = winnerPositions?.includes(index) ?? false;
    const isClickable = Boolean(matchId && isMyTurn && !winner && cell === 0);

    const winLineClass =
      isWinningCell && outcomeTone === "loss"
        ? "cell-win cell-win--loss"
        : isWinningCell
          ? "cell-win"
          : "";

    return (
      <button
        key={index}
        className={`cell ${winLineClass}`}
        onClick={() => void handleCellClick(index)}
        disabled={!isClickable}
      >
        {char}
      </button>
    );
  }

  const shellClass = [
    "game-shell",
    outcomeTone ? `game-shell--${outcomeTone}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={`game-screen${outcomeTone ? ` game-screen--${outcomeTone}` : ""}`}>
      <section className={shellClass}>
        <header className="game-header">
          <h1 className="game-title">Tic-Tac-Toe Multiplayer</h1>
        </header>

        <section className="hud-row">
          <div
            className={[
              "hud-pill",
              outcomeTone ? `hud-pill--${outcomeTone}` : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span className="hud-label">Status</span>
            <span>{status}</span>
          </div>
          <div className="hud-pill">
            <span className="hud-label">You</span>
            <span>{myMarkChar}</span>
          </div>
          <div className="hud-pill">
            <span className="hud-label">{timerHudLabel}</span>
            <span>{timerHudValue}</span>
          </div>
        </section>

        <div className="action-row">
          <button
            className="action-btn"
            onClick={handleConnect}
            disabled={isConnected}
          >
            {isConnected ? "Connected" : "Connect"}
          </button>
          <button
            className="action-btn"
            onClick={handleFindMatch}
            disabled={!isConnected}
          >
            Find Match
          </button>
        </div>

        <section
          className={[
            "board",
            outcomeTone ? `board--${outcomeTone}` : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {Array.from({ length: 9 }).map((_, i) => renderCell(i))}
        </section>

        {resultMessage && (
          <div
            className={[
              "result-banner",
              outcomeTone ? `result-banner--${outcomeTone}` : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {resultMessage}
          </div>
        )}

        <footer className="meta-line">
          {matchId ? (
            <span>Match ready. Play on two clients to test multiplayer.</span>
          ) : (
            <span>Connect and find a match to start.</span>
          )}
        </footer>
      </section>
    </main>
  );
}

export default App;
