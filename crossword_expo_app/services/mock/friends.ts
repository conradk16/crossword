import { MockContext, parseBody, delay, buildJson } from './utils';

type User = { id: string; username: string };
type IncomingRequest = { requestId: string; fromUser: User };
type OutgoingRequest = { requestId: string; toUser: User };

type FriendsState = {
  users: User[];
  friendsByUserId: Map<string, Set<string>>;
  incomingByUserId: Map<string, IncomingRequest[]>;
  outgoingByUserId: Map<string, OutgoingRequest[]>;
  nextRequestId: number;
};

function getFriendsState(): FriendsState {
  const existing = (global as any).__FRIENDS_STATE__ as FriendsState | undefined;
  if (existing) return existing;
  const users: User[] = [
    { id: 'user-abc-123', username: 'you' },
    { id: 'user-ghi-012', username: 'best_friend' },
    { id: 'user-jkl-345', username: 'puzzler_pal' },
    { id: 'user-xyz-789', username: 'crossword_pro' },
    { id: 'user-def-456', username: 'pro_puzzler' },
    { id: 'user-lmo-321', username: 'jane_doe' },
    { id: 'user-xyz-999', username: 'slowpoke' },
  ];
  const state: FriendsState = {
    users,
    friendsByUserId: new Map<string, Set<string>>(),
    incomingByUserId: new Map<string, IncomingRequest[]>(),
    outgoingByUserId: new Map<string, OutgoingRequest[]>(),
    nextRequestId: 1000,
  };
  state.friendsByUserId.set('user-abc-123', new Set(['user-ghi-012']));
  state.friendsByUserId.set('user-ghi-012', new Set(['user-abc-123']));
  state.incomingByUserId.set('user-abc-123', [
    { requestId: 'req-111', fromUser: { id: 'user-lmo-321', username: 'jane_doe' } },
  ]);
  state.outgoingByUserId.set('user-abc-123', [
    { requestId: 'req-222', toUser: { id: 'user-xyz-789', username: 'crossword_pro' } },
  ]);
  (global as any).__FRIENDS_STATE__ = state;
  return state;
}

function findUserById(id: string): User | null {
  const state = getFriendsState();
  return state.users.find((u) => u.id === id) || null;
}

function getFriendsSet(uid: string): Set<string> {
  const state = getFriendsState();
  if (!state.friendsByUserId.has(uid)) {
    state.friendsByUserId.set(uid, new Set());
  }
  return state.friendsByUserId.get(uid)!;
}

function getIncoming(uid: string): IncomingRequest[] {
  const state = getFriendsState();
  if (!state.incomingByUserId.has(uid)) {
    state.incomingByUserId.set(uid, []);
  }
  return state.incomingByUserId.get(uid)!;
}

function getOutgoing(uid: string): OutgoingRequest[] {
  const state = getFriendsState();
  if (!state.outgoingByUserId.has(uid)) {
    state.outgoingByUserId.set(uid, []);
  }
  return state.outgoingByUserId.get(uid)!;
}

export async function handleFriendsRoutes(ctx: MockContext): Promise<Response | null> {
  const { urlString, method, currentUserId, currentUsername } = ctx;

  // GET /api/users/search?username={query}
  if (urlString.startsWith('/api/users/search')) {
    await delay(300);
    const u = new URL(urlString, 'https://mock.local');
    const q = (u.searchParams.get('username') || '').toLowerCase();
    const friends = getFriendsSet(currentUserId);
    const results = getFriendsState().users
      .filter((user) => user.id !== currentUserId)
      .filter((user) => user.username.toLowerCase().includes(q))
      .map((u) => ({ id: u.id, username: u.username }))
      .filter((u) => !friends.has(u.id));
    return buildJson({ users: results }, 200);
  }

  // POST /api/friends/requests
  if (urlString === '/api/friends/requests' && method === 'POST') {
    await delay(300);
    const body = await parseBody<{ recipientId: string }>(ctx.options);
    const recipientId = body?.recipientId;
    if (!recipientId) return buildJson({ error: 'recipientId required' }, 400);
    if (recipientId === currentUserId) return buildJson({ error: 'Cannot send a friend request to yourself.' }, 400);
    const recipient = findUserById(recipientId);
    if (!recipient) return buildJson({ error: 'Recipient not found.' }, 404);
    const friends = getFriendsSet(currentUserId);
    if (friends.has(recipientId)) return buildJson({ message: 'Already friends.' }, 202);
    const outgoing = getOutgoing(currentUserId);
    const incomingOfRecipient = getIncoming(recipientId);
    const existing =
      outgoing.find((r) => r.toUser.id === recipientId) ||
      incomingOfRecipient.find((r) => r.fromUser.id === currentUserId);
    if (existing) return buildJson({ message: 'Friend request sent.' }, 202);
    const state = getFriendsState();
    const newId = `req-${state.nextRequestId++}`;
    outgoing.push({ requestId: newId, toUser: { id: recipient.id, username: recipient.username } });
    incomingOfRecipient.push({ requestId: newId, fromUser: { id: currentUserId, username: currentUsername } });
    return buildJson({ message: 'Friend request sent.' }, 202);
  }

  // GET /api/friends/requests
  if (urlString === '/api/friends/requests' && method === 'GET') {
    await delay(300);
    const incoming = getIncoming(currentUserId);
    return buildJson({ incoming }, 200);
  }

  // PUT /api/friends/requests/{requestId}
  if (urlString.startsWith('/api/friends/requests/') && method === 'PUT') {
    await delay(300);
    const requestId = urlString.split('/').pop() as string;
    const body = await parseBody<{ action: 'accept' | 'decline' }>(ctx.options);
    const action = body?.action;
    if (!requestId || !action) return buildJson({ error: 'Invalid request.' }, 400);
    const incoming = getIncoming(currentUserId);
    const reqIndex = incoming.findIndex((r) => r.requestId === requestId);
    if (reqIndex === -1) return buildJson({ error: 'Friend request not found.' }, 404);
    const req = incoming[reqIndex];
    incoming.splice(reqIndex, 1);
    const senderOutgoing = getOutgoing(req.fromUser.id);
    const senderOutIndex = senderOutgoing.findIndex((r) => r.requestId === requestId);
    if (senderOutIndex !== -1) senderOutgoing.splice(senderOutIndex, 1);
    if (action === 'accept') {
      getFriendsSet(currentUserId).add(req.fromUser.id);
      getFriendsSet(req.fromUser.id).add(currentUserId);
      return buildJson({ message: 'Friend request accepted.' }, 200);
    }
    return buildJson({ message: 'Friend request declined.' }, 200);
  }

  // GET /api/friends
  if (urlString === '/api/friends' && method === 'GET') {
    await delay(300);
    const friendIds = Array.from<string>(getFriendsSet(currentUserId));
    const friends = friendIds.map((uid) => findUserById(uid)).filter(Boolean) as User[];
    return buildJson({ friends }, 200);
  }

  // DELETE /api/friends/{userId}
  if (urlString.startsWith('/api/friends/') && method === 'DELETE') {
    await delay(300);
    const friendId = urlString.split('/').pop() as string;
    const setA = getFriendsSet(currentUserId);
    const setB = getFriendsSet(friendId);
    setA.delete(friendId);
    setB.delete(currentUserId);
    return buildJson({ message: 'Friend removed successfully.' }, 200);
  }

  return null;
}


