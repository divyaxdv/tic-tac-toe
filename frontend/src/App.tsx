import { useState } from "react";
import { authenticate, connectSocket, findMatch, getSocket } from "./lib/nakama";

function App() {
  const [status, setStatus] = useState<string>("disconnected");
  const [matchId, setMatchId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const handleConnect = async () => {
    try {
      setStatus("authenticating...");
      const session = await authenticate();
      setUserId(session.user_id!);
      setStatus("connecting socket...");
      await connectSocket();
      setStatus("connected");

      const sock = getSocket();
      sock.onmatchdata = (matchData) => {
        console.log("Match data received:", matchData);
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

      const sock = getSocket();
      const match = await sock.joinMatch(id);
      console.log("Joined match:", match);
      setStatus(`in match (${match.presences.length} player(s))`);
    } catch (err) {
      console.error(err);
      setStatus("error — see console");
    }
  };

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
    </div>
  );
}

export default App;
