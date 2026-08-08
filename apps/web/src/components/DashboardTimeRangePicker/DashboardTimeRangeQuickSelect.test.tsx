import { fireEvent, render, screen } from "@testing-library/react";
import { DashboardTimeRangeQuickSelect } from "./DashboardTimeRangeQuickSelect";

describe("DashboardTimeRangeQuickSelect", () => {
  it("renders every requested quick range and marks the active preset", () => {
    render(
      <DashboardTimeRangeQuickSelect
        selection={{ kind: "preset", range: "24h" }}
        timeZone="UTC"
        onChange={jest.fn()}
      />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(10);
    expect(
      screen.getByRole("button", { name: "Last 24 hours" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Last 60 days" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Last 90 days" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("selects an existing preset range", () => {
    const onChange = jest.fn();

    render(
      <DashboardTimeRangeQuickSelect
        selection={{ kind: "preset", range: "24h" }}
        timeZone="UTC"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));

    expect(onChange).toHaveBeenCalledWith({ kind: "preset", range: "7d" });
  });

  it("renders only the configured mobile ranges", () => {
    render(
      <DashboardTimeRangeQuickSelect
        ranges={["3h", "6h", "12h", "24h"]}
        selection={{ kind: "preset", range: "24h" }}
        timeZone="UTC"
        onChange={jest.fn()}
      />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(
      screen.getByRole("button", { name: "Last 3 hours" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Last 24 hours" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Last 3 days" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Last 90 days" }),
    ).not.toBeInTheDocument();
  });

  it("uses one column per option when six ranges are configured", () => {
    render(
      <DashboardTimeRangeQuickSelect
        ranges={["3h", "6h", "12h", "24h", "3d", "7d"]}
        selection={{ kind: "preset", range: "24h" }}
        timeZone="UTC"
        onChange={jest.fn()}
      />,
    );

    expect(screen.getByRole("group", { name: "Quick time range" })).toHaveClass(
      "grid-cols-6",
    );
  });

  it.each([
    ["Last 60 days", "60d"],
    ["Last 90 days", "90d"],
  ])("selects %s as a dashboard preset", (accessibleName, range) => {
    const onChange = jest.fn();

    render(
      <DashboardTimeRangeQuickSelect
        selection={{ kind: "preset", range: "24h" }}
        timeZone="UTC"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: accessibleName }));

    expect(onChange).toHaveBeenCalledWith({ kind: "preset", range });
  });
});
