import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { DevicePicker } from "./DevicePicker";

const dev = (deviceId: string, label: string): MediaDeviceInfo =>
  ({ deviceId, label, kind: "audiooutput", groupId: "", toJSON: () => ({}) } as MediaDeviceInfo);

test("lists devices and reports selection changes", async () => {
  const onChange = vi.fn();
  render(
    <DevicePicker
      kind="audiooutput"
      label="Earpiece"
      devices={[dev("bbb", "Scarlett IEM-2")]}
      value=""
      onChange={onChange}
      needsPermission={false}
      onEnableLabels={() => {}}
    />,
  );
  await userEvent.selectOptions(screen.getByRole("combobox"), "bbb");
  expect(onChange).toHaveBeenCalledWith("bbb");
});

test("shows the enable-names button only when permission is needed", async () => {
  const onEnable = vi.fn();
  const { rerender } = render(
    <DevicePicker
      kind="audiooutput"
      label="Earpiece"
      devices={[]}
      value=""
      onChange={() => {}}
      needsPermission
      onEnableLabels={onEnable}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: /enable names/i }));
  expect(onEnable).toHaveBeenCalled();
  rerender(
    <DevicePicker
      kind="audiooutput"
      label="Earpiece"
      devices={[]}
      value=""
      onChange={() => {}}
      needsPermission={false}
      onEnableLabels={onEnable}
    />,
  );
  expect(screen.queryByRole("button", { name: /enable names/i })).toBeNull();
});
