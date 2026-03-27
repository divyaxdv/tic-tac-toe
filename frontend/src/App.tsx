import { useMemo, useState } from "react";
import { authenticate, connectSocket, findMatch, getSocket } from "./lib/nakama";

type MatchDataLike = {
  opCode?: number;
  op_code?: number;
  opcode?: number;
  data?: unknown;
  payload?: unknown;
  // Keep index signature so we can read other optional fields safely.
  [key: string]: unknown;
};

function App() {
  const [status, setStatus] = useState<string>("disconnected");
  const [matchId, setMatchId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Keep these in sync with backend OpCode values.
  const OPCODE_START = 1;
  const OPCODE_UPDATE = 2;
  const OPCODE_DONE = 3;
  const OPCODE_REJECTED = 5;

  const [board, setBoard] = useState<number[]>([]);
  const [marks, setMarks] = useState<Record<string, number>>({});
  const [activePlayer, setActivePlayer] = useState<string | null>(null);
  const [deadlineRemainingTicks, setDeadlineRemainingTicks] = useState<number>(0);
  const [winner, setWinner] = useState<string | null>(null);
  const [winnerPositions, setWinnerPositions] = useState<number[] | null>(null);

  const myMark = useMemo(() => {
    if (!userId) return null;
    const v = marks[userId];
    return typeof v === "number" ? v : null;
  }, [marks, userId]);

  const myMarkChar = useMemo(() => {
    if (myMark === 1) return "X";
    if (myMark === 2) return "O";
    return "?";
  }, [myMark]);

  function parsePayload(raw: unknown): unknown | null {
    if (!raw) return null;
    // nakama-js often provides string data; sometimes it can be Uint8Array.
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
    return raw ?? null;
  }

  const handleConnect = async () => {
    try {
      setStatus("authenticating...");
      const session = await authenticate();
      setUserId(session.user_id!);
      setStatus("connecting socket...");
      await connectSocket();
      setStatus("connected");

      const sock = getSocket();
      sock.onmatchdata = (matchData: unknown) => {
        // matchData shape can vary a bit by nakama-js version; keep logs for debugging.
        console.log("Match data received:", matchData);

        const md = matchData as MatchDataLike;
        const op = md?.opCode ?? md?.op_code ?? md?.opcode ?? null;
        const opNum =
          op === null || op === undefined || (typeof op !== "number" && typeof op !== "string")
            ? null
            : Number(op);

        const parsed = parsePayload(md?.data ?? md?.payload ?? md);
        const p =
          parsed && typeof parsed === "object"
            ? (parsed as Record<string, unknown>)
            : null;

        if (opNum === OPCODE_START) {
          const nextBoard = Array.isArray(p?.board)
            ? (p!.board as unknown[]).map((v) =>
                typeof v === "number" ? v : 0
              )
            : [];
          setBoard(nextBoard);

          const marksRaw = p?.marks;
          const nextMarks =
            marksRaw && typeof marksRaw === "object" && !Array.isArray(marksRaw)
              ? (marksRaw as Record<string, number>)
              : {};
          setMarks(nextMarks);

          setActivePlayer(typeof p?.activePlayer === "string" ? p.activePlayer : null);
          setDeadlineRemainingTicks(
            typeof p?.deadlineRemainingTicks === "number"
              ? (p.deadlineRemainingTicks as number)
              : 0
          );
          setWinner(null);
          setWinnerPositions(null);

          setStatus("in match (2 player(s))");
        } else if (opNum === OPCODE_UPDATE) {
          const nextBoard = Array.isArray(p?.board)
            ? (p!.board as unknown[]).map((v) => (typeof v === "number" ? v : 0))
            : [];
          setBoard(nextBoard);
          const nextActivePlayer =
            typeof p?.activePlayer === "string" ? p.activePlayer : null;
          setActivePlayer(nextActivePlayer);
          setDeadlineRemainingTicks(
            typeof p?.deadlineRemainingTicks === "number"
              ? (p.deadlineRemainingTicks as number)
              : 0
          );

          if (winner) return; // avoid flashing during done

          const turn =
            nextActivePlayer && userId && nextActivePlayer === userId
              ? "Your turn"
              : "Opponent's turn";
          setStatus(`in match — ${turn}`);
        } else if (opNum === OPCODE_DONE) {
          const nextBoard = Array.isArray(p?.board)
            ? (p!.board as unknown[]).map((v) => (typeof v === "number" ? v : 0))
            : [];
          setBoard(nextBoard);
          setWinner(typeof p?.winner === "string" ? p.winner : null);
          setWinnerPositions(
            Array.isArray(p?.winnerPositions)
              ? (p!.winnerPositions as unknown[]).map((v) =>
                  typeof v === "number" ? v : 0
                )
              : null
          );

          setStatus("match finished");
        } else if (opNum === OPCODE_REJECTED) {
          setStatus("move rejected");
        }
      };
    } catch (err) {
      console.error(err);
      setStatus("error — see console");
    }
  };

  const handleFindMatch = async () => {
    try {
      setStatus("finding match...");
      const id = await findMatch();
      setMatchId(id);

      // Reset UI state for the new match.
      setBoard([]);
      setMarks({});
      setActivePlayer(null);
      setDeadlineRemainingTicks(0);
      setWinner(null);
      setWinnerPositions(null);

      const sock = getSocket();
      await sock.joinMatch(id);

      // Server will send START when both players are present.
      setStatus("waiting for opponent...");
    } catch (err) {
      console.error(err);
      setStatus("error — see console");
    }
  };

  function renderCell(i: number) {
    const cell = board[i] ?? 0;
    const char = cell === 1 ? "X" : cell === 2 ? "O" : "";
    const isWinningCell = winnerPositions?.includes(i) ?? false;

    return (
      <div
        key={i}
        style={{
          width: 78,
          height: 78,
          borderRadius: 12,
          border: isWinningCell ? "3px solid #22c55e" : "2px solid #334155",
          background: isWinningCell ? "rgba(34,197,94,0.15)" : "rgba(2,6,23,0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 34,
          fontWeight: 800,
          userSelect: "none",
        }}
      >
        {char}
      </div>
    );
  }

  return (
    <div style={{ padding: 40, fontFamily: "system-ui, sans-serif" }}>
      <h1>Tic-Tac-Toe — Multiplayer</h1>
      <p>
        <strong>Status:</strong> {status}
      </p>
      {userId && (
        <p>
          <strong>User ID:</strong> {userId}
        </p>
      )}
      {userId && myMark && (
        <p>
          <strong>You are:</strong> {myMarkChar}
        </p>
      )}
      {matchId && (
        <p>
          <strong>Match ID:</strong> {matchId}
        </p>
      )}
      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <button onClick={handleConnect} disabled={status === "connected"}>
          Connect to Nakama
        </button>
        <button onClick={handleFindMatch} disabled={status !== "connected"}>
          Find Match
        </button>
      </div>

      <div style={{ marginTop: 24 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 78px)",
            gap: 10,
            justifyContent: "center",
          }}
        >
          {Array.from({ length: 9 }).map((_, i) => renderCell(i))}
        </div>
        {winner && (
          <p style={{ marginTop: 14 }}>
            Winner: <strong>{winner === userId ? "You" : "Opponent"}</strong>
          </p>
        )}
        {deadlineRemainingTicks > 0 && (
          <p style={{ marginTop: 6, color: "#64748b" }}>
            Timer ticks: {deadlineRemainingTicks}
          </p>
        )}
      </div>
    </div>
  );
}

export default App;
