"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useRequireAuth } from "@/lib/useRequireAuth";
import PageBackground from "@/components/PageBackground";

const getBlockedUsersFn = httpsCallable(functions, "getBlockedUsers");
const unblockUserFn = httpsCallable(functions, "unblockUser");

type BlockedUser = { uid: string; displayName: string; photoURL: string | null };

export default function BlockedAccountsPage() {
  const { loading: authLoading } = useRequireAuth();
  const [users, setUsers] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unblockingUid, setUnblockingUid] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const result = await getBlockedUsersFn();
        setUsers((result.data as any).users);
      } catch (err: any) {
        setLoadError(err.message ?? "Couldn't load your blocked accounts.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleUnblock(uid: string) {
    setUnblockingUid(uid);
    try {
      await unblockUserFn({ targetUid: uid });
      setUsers((prev) => prev.filter((u) => u.uid !== uid));
    } catch (err: any) {
      alert(err.message ?? "Couldn't unblock this account. Please try again.");
    } finally {
      setUnblockingUid(null);
    }
  }

  if (authLoading || loading) {
    return <p className="text-ink/50 text-center py-16">Loading…</p>;
  }

  return (
    <div className="pb-16">
      <PageBackground color="#ECE8F7" />
      <div className="flex items-center justify-between mb-5">
        <p className="font-display text-lg font-semibold">Blocked accounts</p>
        <Link href="/me" className="text-xs text-ink/40 hover:text-ink">
          Back
        </Link>
      </div>

      {loadError && <p className="text-sm text-red-600 mb-4">{loadError}</p>}

      {users.length === 0 && !loadError ? (
        <p className="text-ink/50 text-sm text-center py-14">You haven't blocked anyone.</p>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.uid} className="flex items-center gap-3 border border-line/15 rounded-xl p-3">
              {u.photoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={u.photoURL} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-medium flex-shrink-0"
                  style={{ background: "#E85D5D" }}
                >
                  {(u.displayName ?? "M")[0]}
                </div>
              )}
              <p className="text-sm font-medium truncate flex-1">{u.displayName ?? "Member"}</p>
              <button
                onClick={() => handleUnblock(u.uid)}
                disabled={unblockingUid === u.uid}
                className="btn-secondary text-xs px-3 py-1.5 flex-shrink-0"
              >
                {unblockingUid === u.uid ? "Unblocking…" : "Unblock"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
