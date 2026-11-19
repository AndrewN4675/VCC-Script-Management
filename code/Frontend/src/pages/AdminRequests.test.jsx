import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminRequests from "./AdminRequests";
import { api, httpError } from "../test/apiMock";

vi.mock("../api/client", () => import("../test/apiMock"));

const PAT = { id: 1, name: "Pat Doe", email: "pat@example.com", created_at: "2026-11-04 18:00:00" };
const SAM = { id: 2, name: "Sam Lee", email: "sam@example.com", created_at: "2026-11-04 19:00:00" };

const LINK = "https://app.example.com/set-password?token=abc123";

const rowFor = async (email) => (await screen.findByText(email)).closest("tr");

describe("Admin Requests page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listAccessRequests.mockResolvedValue([PAT, SAM]);
  });

  it("lists pending requests with a role dropdown", async () => {
    render(<AdminRequests />);
    const row = await rowFor("pat@example.com");
    expect(within(row).getByText("Pat Doe")).toBeInTheDocument();
    const select = within(row).getByLabelText("Role for pat@example.com");
    expect([...select.options].map((o) => o.value)).toEqual(["", "requester", "script viewer", "script editor", "admin"]);
  });

  it("shows an empty state", async () => {
    api.listAccessRequests.mockResolvedValue([]);
    render(<AdminRequests />);
    expect(await screen.findByText("No pending requests.")).toBeInTheDocument();
  });

  it("requires a role before approving, then approves and removes the row", async () => {
    api.approveAccessRequest.mockResolvedValue({ setup_link: LINK });
    const user = userEvent.setup();
    render(<AdminRequests />);
    const row = await rowFor("pat@example.com");
    const approve = within(row).getByRole("button", { name: "Approve" });
    expect(approve).toBeDisabled();

    await user.selectOptions(within(row).getByLabelText("Role for pat@example.com"), "script viewer");
    await user.click(approve);

    expect(api.approveAccessRequest).toHaveBeenCalledWith(1, "script viewer");
    expect(await screen.findByRole("status")).toHaveTextContent("Approved pat@example.com as script viewer");
    expect(screen.queryByLabelText("Role for pat@example.com")).not.toBeInTheDocument();
    expect(screen.getByText("sam@example.com")).toBeInTheDocument();
  });

  it("shows the setup link after approving, and copies it", async () => {
    api.approveAccessRequest.mockResolvedValue({ setup_link: LINK });
    const user = userEvent.setup();
    render(<AdminRequests />);
    const row = await rowFor("pat@example.com");
    await user.selectOptions(within(row).getByLabelText("Role for pat@example.com"), "requester");
    await user.click(within(row).getByRole("button", { name: "Approve" }));

    expect(await screen.findByLabelText("Setup link for pat@example.com")).toHaveValue(LINK);
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await navigator.clipboard.readText()).toBe(LINK);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("falls back to selecting the link when the clipboard is unavailable", async () => {
    api.approveAccessRequest.mockResolvedValue({ setup_link: LINK });
    const user = userEvent.setup();
    render(<AdminRequests />);
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    document.execCommand = vi.fn().mockReturnValue(false);

    const row = await rowFor("pat@example.com");
    await user.selectOptions(within(row).getByLabelText("Role for pat@example.com"), "requester");
    await user.click(within(row).getByRole("button", { name: "Approve" }));
    await user.click(await screen.findByRole("button", { name: "Copy link" }));

    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(await screen.findByText("Press Ctrl+C to copy")).toBeInTheDocument();
  });

  it("keeps every link until it is dismissed", async () => {
    api.approveAccessRequest
      .mockResolvedValueOnce({ setup_link: `${LINK}1` })
      .mockResolvedValueOnce({ setup_link: `${LINK}2` });
    const user = userEvent.setup();
    render(<AdminRequests />);
    for (const email of ["pat@example.com", "sam@example.com"]) {
      const row = await rowFor(email);
      await user.selectOptions(within(row).getByLabelText(`Role for ${email}`), "requester");
      await user.click(within(row).getByRole("button", { name: "Approve" }));
    }

    expect(await screen.findByLabelText("Setup link for sam@example.com")).toHaveValue(`${LINK}2`);
    expect(screen.getByLabelText("Setup link for pat@example.com")).toHaveValue(`${LINK}1`);

    await user.click(screen.getAllByRole("button", { name: "Done" })[0]);
    expect(screen.queryByLabelText("Setup link for pat@example.com")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Setup link for sam@example.com")).toBeInTheDocument();
  });

  it("does not show a link after denying", async () => {
    api.denyAccessRequest.mockResolvedValue("");
    const user = userEvent.setup();
    render(<AdminRequests />);
    const row = await rowFor("sam@example.com");
    await user.click(within(row).getByRole("button", { name: "Deny" }));
    await screen.findByRole("status");
    expect(screen.queryByRole("button", { name: "Copy link" })).not.toBeInTheDocument();
  });

  it("asks for confirmation before granting admin", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    api.approveAccessRequest.mockResolvedValue("");
    const user = userEvent.setup();
    render(<AdminRequests />);
    const row = await rowFor("pat@example.com");
    await user.selectOptions(within(row).getByLabelText("Role for pat@example.com"), "admin");

    await user.click(within(row).getByRole("button", { name: "Approve" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("pat@example.com an admin"));
    expect(api.approveAccessRequest).not.toHaveBeenCalled();

    await user.click(within(row).getByRole("button", { name: "Approve" }));
    expect(api.approveAccessRequest).toHaveBeenCalledWith(1, "admin");
  });

  it("does not ask for confirmation for non-admin roles", async () => {
    const confirm = vi.spyOn(window, "confirm");
    api.approveAccessRequest.mockResolvedValue("");
    const user = userEvent.setup();
    render(<AdminRequests />);
    const row = await rowFor("pat@example.com");
    await user.selectOptions(within(row).getByLabelText("Role for pat@example.com"), "script editor");
    await user.click(within(row).getByRole("button", { name: "Approve" }));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("denies and removes the row", async () => {
    api.denyAccessRequest.mockResolvedValue("");
    const user = userEvent.setup();
    render(<AdminRequests />);
    const row = await rowFor("sam@example.com");
    await user.click(within(row).getByRole("button", { name: "Deny" }));

    expect(api.denyAccessRequest).toHaveBeenCalledWith(2);
    expect(await screen.findByRole("status")).toHaveTextContent("Denied sam@example.com.");
    expect(screen.queryByText("sam@example.com")).not.toBeInTheDocument();
  });

  it("reloads when a request is no longer pending", async () => {
    api.denyAccessRequest.mockRejectedValue(httpError(409, "request is not pending"));
    const user = userEvent.setup();
    render(<AdminRequests />);
    const row = await rowFor("pat@example.com");
    api.listAccessRequests.mockResolvedValue([SAM]);
    await user.click(within(row).getByRole("button", { name: "Deny" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("pat@example.com is no longer pending.");
    expect(api.listAccessRequests).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("sam@example.com")).toBeInTheDocument();
  });

  it("keeps the row and shows the reason when the setup email fails", async () => {
    api.approveAccessRequest.mockRejectedValue(httpError(502, "could not send setup email; request is still pending\n"));
    const user = userEvent.setup();
    render(<AdminRequests />);
    const row = await rowFor("pat@example.com");
    await user.selectOptions(within(row).getByLabelText("Role for pat@example.com"), "requester");
    await user.click(within(row).getByRole("button", { name: "Approve" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("could not send setup email");
    expect(screen.getByText("pat@example.com")).toBeInTheDocument();
  });

  it("shows an error if the list cannot load", async () => {
    api.listAccessRequests.mockRejectedValue(httpError(403, "forbidden"));
    render(<AdminRequests />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load access requests.");
  });
});
