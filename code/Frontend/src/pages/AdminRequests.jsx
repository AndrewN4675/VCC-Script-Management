import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";

const ROLES =["requester", "script viewer", "script editor", "admin"];

// handles format date (created_at is UTC "YYYY-MM-DD HH:MM:SS")
const formatDate = (value) => {
  const d = new Date(String(value).replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
};

// handles request row
const RequestRow = ({ request, busy, onApprove, onDeny }) => {
  const [role, setRole] = useState("");
  return (
    <tr className="border-t">
      <td className="px-3 py-2">{request.name}</td>
      <td className="px-3 py-2">{request.email}</td>
      <td className="px-3 py-2 text-gray-600">{formatDate(request.created_at)}</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={`Role for ${request.email}`}
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1"
          >
            <option value="">Select role…</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !role}
            onClick={() => onApprove(request, role)}
            className="rounded-md bg-blue-600 px-3 py-1 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Approve
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDeny(request)}
            className="rounded-md border border-[#981e32] px-3 py-1 text-[#981e32] hover:bg-red-50 disabled:opacity-50"
          >
            Deny
          </button>
        </div>
      </td>
    </tr>
  );
};

// Copies text to the clipboard. The async Clipboard API only exists on https or
// localhost, and the app is often served over plain http on a local network, so
// fall back to selecting the field and using the older copy command.
const copyText = async (text, input) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the older method
  }
  try {
    input?.select();
    return document.execCommand("copy");
  } catch {
    return false;
  }
};

// handles setup link: shown once after approving, since only a hash of the
// token is stored and the link cannot be shown again.
const SetupLink = ({ invite, onDismiss }) => {
  const inputRef = useRef(null);
  const [copyState, setCopyState] = useState("");

  // handles copy
  const handleCopy = async () => {
    const ok = await copyText(invite.link, inputRef.current);
    setCopyState(ok ? "Copied" : "Press Ctrl+C to copy");
  };

  return (
    <div className="mb-4 rounded-md border border-gray-300 bg-gray-50 p-4 text-sm">
      <p className="mb-2">
        Send this link to <strong>{invite.email}</strong> so they can set their password. It works once and expires in
        48 hours. Copy it now; it can&apos;t be shown again.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          readOnly
          aria-label={`Setup link for ${invite.email}`}
          value={invite.link}
          onFocus={(e) => e.target.select()}
          className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-xs"
        />
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-md bg-blue-600 px-3 py-1 text-white hover:bg-blue-700"
        >
          Copy link
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-100"
        >
          Done
        </button>
      </div>
      {copyState ? (
        <p role="status" className="mt-2 text-green-700">
          {copyState}
        </p>
      ) : null}
    </div>
  );
};

// handles admin requests
const AdminRequests = () => {
  const [requests, setRequests] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState(null); // { type: "success" | "error", text }
  const [busyId, setBusyId] = useState(null);
  const [invites, setInvites] = useState([]); // [{ email, link }] shown until dismissed

  // handles load
  const load = useCallback(async () => {
    setLoadError("");
    try {
      setRequests(await api.listAccessRequests());
    } catch {
      setLoadError("Could not load access requests.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // handles run action
  const runAction = async (request, action, successText, onResult) => {
    setBusyId(request.id);
    setMessage(null);
    try {
      const result = await action();
      setRequests((list) => list.filter((r) => r.id !== request.id));
      setMessage({ type: "success", text: successText });
      onResult?.(result);
    } catch (err) {
      if (err?.status === 404 || err?.status === 409) {
        setMessage({ type: "error", text: `${request.email} is no longer pending.` });
        load();
      } else if (err?.status === 400 || err?.status === 502) {
        setMessage({ type: "error", text: err.message.trim() });
      } else {
        setMessage({ type: "error", text: "Something went wrong. Please try again." });
      }
    } finally {
      setBusyId(null);
    }
  };

  // handles approve
  const handleApprove = (request, role) => {
    if (
      role === "admin" &&
      !window.confirm(`Make ${request.email} an admin? Admins can approve requests and create other admins.`)
    ) {
      return;
    }
    runAction(
      request,
      () => api.approveAccessRequest(request.id, role),
      `Approved ${request.email} as ${role}.`,
      (result) => {
        if (result?.setup_link) {
          setInvites((list) => [...list, { email: request.email, link: result.setup_link }]);
        }
      }
    );
  };

  // handles deny
  const handleDeny = (request) =>
    runAction(request, () => api.denyAccessRequest(request.id), `Denied ${request.email}.`);

  return (
    <section className="bg-white rounded-lg shadow p-6">
      <h1 className="text-3xl font-bold mb-6">Access Requests</h1>
      {message ? (
        <p
          role={message.type === "error" ? "alert" : "status"}
          className={`mb-4 text-sm ${message.type === "error" ? "text-red-700" : "text-green-700"}`}
        >
          {message.text}
        </p>
      ) : null}
      {invites.map((invite) => (
        <SetupLink
          key={invite.link}
          invite={invite}
          onDismiss={() => setInvites((list) => list.filter((i) => i !== invite))}
        />
      ))}
      {loadError ? (
        <p role="alert" className="text-sm text-red-700">
          {loadError}
        </p>
      ) : requests === null ? (
        <p className="text-gray-600">Loading…</p>
      ) : requests.length === 0 ? (
        <p className="text-gray-600">No pending requests.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-gray-600">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Requested</th>
                <th className="px-3 py-2 font-medium">Decision</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <RequestRow
                  key={r.id}
                  request={r}
                  busy={busyId === r.id}
                  onApprove={handleApprove}
                  onDeny={handleDeny}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default AdminRequests;
