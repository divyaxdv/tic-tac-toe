const moduleName = "tic-tac-toe";

const tickRate = 5;
const maxPlayers = 2;
/** Close the match if no game starts (still waiting in lobby) within this time. */
const maxLobbyWaitSec = 120;

interface MatchState {
  board: number[];
  marks: { [userId: string]: number };
  activePlayer: string | null;
  deadlineRemainingTicks: number;
  winner: string | null;
  winnerPositions: number[] | null;
  playing: boolean;
  presences: { [userId: string]: nkruntime.Presence };
  nextGameRemainingTicks: number;
  /** Decremented each match tick while waiting for a game to start; then match ends. */
  lobbyTicksRemaining: number;
}

const Mark = {
  X: 1,
  O: 2,
  UNDEFINED: 0,
};

const OpCode = {
  START: 1,
  UPDATE: 2,
  DONE: 3,
  MOVE: 4,
  REJECTED: 5,
};

function matchInit(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  params: { [key: string]: string }
): { state: nkruntime.MatchState; tickRate: number; label: string } {
  logger.info("Match created");

  const state: MatchState = {
    board: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    marks: {},
    activePlayer: null,
    deadlineRemainingTicks: 0,
    winner: null,
    winnerPositions: null,
    playing: false,
    presences: {},
    nextGameRemainingTicks: 0,
    lobbyTicksRemaining: tickRate * maxLobbyWaitSec,
  };

  return {
    state,
    tickRate,
    label: "",
  };
}

function matchJoinAttempt(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  presence: nkruntime.Presence,
  metadata: { [key: string]: any }
): {
  state: nkruntime.MatchState;
  accept: boolean;
  rejectMessage?: string;
} | null {
  const s = state as MatchState;
  logger.info("%s attempted to join", presence.userId);

  const playerCount = Object.keys(s.presences).length;
  if (playerCount >= maxPlayers) {
    return { state: s, accept: false, rejectMessage: "Match is full" };
  }

  return { state: s, accept: true };
}

function matchJoin(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  presences: nkruntime.Presence[]
): { state: nkruntime.MatchState } | null {
  const s = state as MatchState;

  for (const presence of presences) {
    s.presences[presence.userId] = presence;
    logger.info("%s joined", presence.userId);
  }

  const players = Object.keys(s.presences);
  if (players.length === maxPlayers && !s.playing) {
    s.playing = true;

    s.marks[players[0]] = Mark.X;
    s.marks[players[1]] = Mark.O;
    s.activePlayer = players[0];
    s.board = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    s.winner = null;
    s.winnerPositions = null;
    s.deadlineRemainingTicks = tickRate * 30;

    const startMsg = JSON.stringify({
      board: s.board,
      marks: s.marks,
      activePlayer: s.activePlayer,
      deadlineRemainingTicks: s.deadlineRemainingTicks,
    });

    dispatcher.broadcastMessage(OpCode.START, startMsg);
    logger.info("Game started between %s (X) and %s (O)", players[0], players[1]);
  }

  return { state: s };
}

function matchLeave(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  presences: nkruntime.Presence[]
): { state: nkruntime.MatchState } | null {
  const s = state as MatchState;

  for (const presence of presences) {
    logger.info("%s left", presence.userId);
    delete s.presences[presence.userId];
  }

  const remainingPlayers = Object.keys(s.presences);

  if (s.playing && remainingPlayers.length < maxPlayers) {
    s.playing = false;
    if (remainingPlayers.length === 1) {
      s.winner = remainingPlayers[0];
      const doneMsg = JSON.stringify({
        board: s.board,
        winner: s.winner,
        winnerPositions: null,
        reason: "opponent_left",
      });
      dispatcher.broadcastMessage(OpCode.DONE, doneMsg);
    }
  }

  return { state: s };
}

function matchLoop(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  messages: nkruntime.MatchMessage[]
): { state: nkruntime.MatchState } | null {
  const s = state as MatchState;

  if (!s.playing && Object.keys(s.marks).length === 0) {
    s.lobbyTicksRemaining--;
    if (s.lobbyTicksRemaining <= 0) {
      logger.info("Lobby timed out after %ds", maxLobbyWaitSec);
      return null;
    }
  }

  // First matchLoop tick can run before joinMatch adds presences; returning null
  // would stop the match and clients get "Match not found" on join.
  if (Object.keys(s.presences).length === 0) {
    if (!s.playing && Object.keys(s.marks).length === 0) {
      return { state: s };
    }
    return null;
  }

  if (!s.playing) {
    return { state: s };
  }

  if (s.deadlineRemainingTicks > 0) {
    s.deadlineRemainingTicks--;
  }

  if (s.deadlineRemainingTicks <= 0 && s.activePlayer !== null) {
    const otherPlayers = Object.keys(s.presences).filter(
      (id) => id !== s.activePlayer
    );
    if (otherPlayers.length > 0) {
      s.winner = otherPlayers[0];
    }

    const doneMsg = JSON.stringify({
      board: s.board,
      winner: s.winner,
      winnerPositions: null,
      reason: "timeout",
    });
    dispatcher.broadcastMessage(OpCode.DONE, doneMsg);
    s.playing = false;
    s.activePlayer = null;
    return { state: s };
  }

  for (const message of messages) {
    if (message.opCode !== OpCode.MOVE) {
      continue;
    }

    if (message.sender.userId !== s.activePlayer) {
      dispatcher.broadcastMessage(
        OpCode.REJECTED,
        JSON.stringify({ reason: "not_your_turn" }),
        [message.sender]
      );
      continue;
    }

    let moveData: { position: number };
    try {
      moveData = JSON.parse(nk.binaryToString(message.data));
    } catch (e) {
      dispatcher.broadcastMessage(
        OpCode.REJECTED,
        JSON.stringify({ reason: "invalid_data" }),
        [message.sender]
      );
      continue;
    }

    const pos = moveData.position;
    if (pos < 0 || pos > 8 || s.board[pos] !== Mark.UNDEFINED) {
      dispatcher.broadcastMessage(
        OpCode.REJECTED,
        JSON.stringify({ reason: "invalid_position" }),
        [message.sender]
      );
      continue;
    }

    s.board[pos] = s.marks[message.sender.userId];

    const winResult = checkWin(s.board);
    if (winResult) {
      s.winner = message.sender.userId;
      s.winnerPositions = winResult;
      s.playing = false;
      s.activePlayer = null;

      const doneMsg = JSON.stringify({
        board: s.board,
        winner: s.winner,
        winnerPositions: s.winnerPositions,
        reason: "win",
      });
      dispatcher.broadcastMessage(OpCode.DONE, doneMsg);
      return { state: s };
    }

    if (isBoardFull(s.board)) {
      s.winner = null;
      s.playing = false;
      s.activePlayer = null;

      const doneMsg = JSON.stringify({
        board: s.board,
        winner: null,
        winnerPositions: null,
        reason: "draw",
      });
      dispatcher.broadcastMessage(OpCode.DONE, doneMsg);
      return { state: s };
    }

    const players = Object.keys(s.marks);
    s.activePlayer = players.find((id) => id !== message.sender.userId) || null;
    s.deadlineRemainingTicks = tickRate * 30;

    const updateMsg = JSON.stringify({
      board: s.board,
      activePlayer: s.activePlayer,
      deadlineRemainingTicks: s.deadlineRemainingTicks,
    });
    dispatcher.broadcastMessage(OpCode.UPDATE, updateMsg);
  }

  return { state: s };
}

function matchTerminate(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  graceSeconds: number
): { state: nkruntime.MatchState } | null {
  logger.info("Match terminating");
  return { state };
}

function matchSignal(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  data: string
): { state: nkruntime.MatchState; data?: string } | null {
  return { state, data: "signal_received" };
}

function rpcFindMatch(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  const matches = nk.matchList(10, true, null, null, 1, null);

  if (matches.length > 0) {
    return JSON.stringify({ matchId: matches[0].matchId });
  }

  const matchId = nk.matchCreate(moduleName, {});
  return JSON.stringify({ matchId });
}

function checkWin(board: number[]): number[] | null {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];

  for (const line of lines) {
    const [a, b, c] = line;
    if (
      board[a] !== Mark.UNDEFINED &&
      board[a] === board[b] &&
      board[a] === board[c]
    ) {
      return line;
    }
  }

  return null;
}

function isBoardFull(board: number[]): boolean {
  return board.every((cell) => cell !== Mark.UNDEFINED);
}

function InitModule(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  initializer: nkruntime.Initializer
) {
  initializer.registerMatch(moduleName, {
    matchInit,
    matchJoinAttempt,
    matchJoin,
    matchLeave,
    matchLoop,
    matchTerminate,
    matchSignal,
  });

  initializer.registerRpc("find_match", rpcFindMatch);

  logger.info("Tic-Tac-Toe module loaded.");
}

!InitModule && InitModule.bind(null);
