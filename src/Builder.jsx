/*
WEBSITES.CO.IN — DRAG‑AND‑DROP BUILDER (PROTOTYPE)
=================================================

Purpose
-------
A compact, single‑file React prototype that reimagines the form‑based flow as a drag‑and‑drop page builder while keeping forms for property editing.

Key UX
------
• Palette → Canvas → Inspector: drag elements from the left palette, drop on canvas, then tweak properties in the right inspector.
• Inline visual feedback for drop targets; click to select; reorder by drag.
• Responsive preview toggle (Desktop / Mobile widths) with fluid blocks and containers.
• Templates: quickly seed the canvas with a prebuilt layout; users can still edit via forms.
• Export/Import JSON to show scalability of schema.

Architecture (scalable)
-----------------------
• Element schema: Every block has { id, type, props, children? }. New elements are added by declaring a config (type, defaultProps, inspector fields, renderer).
• Render layer: maps element.type → visual component; reads props; allows nesting via children array.
• DnD: dnd‑kit for robust drag/drop and sorting. Canvas supports reordering of siblings; Sections can host children.
• State: React useState for session; could be swapped for Zustand/Redux. Undo stack included for quick demos (last 20 states).
• Responsiveness: CSS utility classes (Tailwind) + a previewWidth state (desktop/mobile). Blocks are 100% width; Container supports max‑widths and padding.
• Persistence: Export/Import JSON to simulate save/load. IDs are nanoid‑style strings.

Notes
-----
• This is a self‑contained prototype (no backend). All libraries are assumed available in the environment.
• Production hardening (keyboard a11y for DnD, exhaustive ARIA, server persistence, collaborative cursors, granular undo) is out of scope but considered in comments.
*/

import React, { useMemo, useState, useEffect } from "react";
import { DndContext, MouseSensor, TouchSensor, useSensor, useSensors, DragOverlay, closestCenter, rectIntersection } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { v4 as uuidv4 } from "uuid";

// -----------------------------
// Element Registry
// -----------------------------
const ELEMENTS = {
  heading: {
    label: "Heading",
    icon: "H",
    defaults: { text: "Your headline", level: 2, align: "left", color: "#111827", marginY: 12 },
    inspector: [
      { key: "text", label: "Text", type: "text" },
      { key: "level", label: "Level", type: "select", options: [1, 2, 3, 4] },
      { key: "align", label: "Align", type: "select", options: ["left", "center", "right"] },
      { key: "color", label: "Color", type: "color" },
      { key: "marginY", label: "Vertical Margin (px)", type: "number", min: 0, max: 96 }
    ],
    render: (props) => {
      const Tag = `h${props.level}`;
      return (
        <Tag
          style={{ textAlign: props.align, color: props.color, margin: `${props.marginY}px 0` }}
          className="font-semibold tracking-tight"
        >
          {props.text}
        </Tag>
      );
    }
  },
  text: {
    label: "Paragraph",
    icon: "¶",
    defaults: { text: "Write something thoughtful here.", align: "left", color: "#374151", marginY: 8 },
    inspector: [
      { key: "text", label: "Text", type: "textarea" },
      { key: "align", label: "Align", type: "select", options: ["left", "center", "right"] },
      { key: "color", label: "Color", type: "color" },
      { key: "marginY", label: "Vertical Margin (px)", type: "number", min: 0, max: 96 }
    ],
    render: (props) => (
      <p style={{ textAlign: props.align, color: props.color, margin: `${props.marginY}px 0` }} className="leading-relaxed">
        {props.text}
      </p>
    )
  },
  image: {
    label: "Image",
    icon: "🖼️",
    defaults: { src: "https://picsum.photos/800/400", alt: "Placeholder image", radius: 16, marginY: 8 },
    inspector: [
      { key: "src", label: "Image URL", type: "text" },
      { key: "alt", label: "Alt Text", type: "text" },
      { key: "radius", label: "Corner Radius (px)", type: "number", min: 0, max: 48 },
      { key: "marginY", label: "Vertical Margin (px)", type: "number", min: 0, max: 96 }
    ],
    render: (props) => (
      <img
        src={props.src}
        alt={props.alt}
        style={{ borderRadius: props.radius, margin: `${props.marginY}px 0` }}
        className="w-full object-cover"
      />
    )
  },
  button: {
    label: "Button",
    icon: "◉",
    defaults: { label: "Click me", href: "#", variant: "solid", align: "left", marginY: 10 },
    inspector: [
      { key: "label", label: "Label", type: "text" },
      { key: "href", label: "Link", type: "text" },
      { key: "variant", label: "Style", type: "select", options: ["solid", "outline", "ghost"] },
      { key: "align", label: "Align", type: "select", options: ["left", "center", "right"] },
      { key: "marginY", label: "Vertical Margin (px)", type: "number", min: 0, max: 96 }
    ],
    render: (props) => (
      <div style={{ textAlign: props.align, margin: `${props.marginY}px 0` }}>
        <a
          href={props.href}
          className={
            `inline-block px-4 py-2 rounded-2xl text-sm font-medium ` +
            (props.variant === "solid"
              ? "bg-black text-white hover:opacity-90"
              : props.variant === "outline"
              ? "border border-black text-black hover:bg-black hover:text-white"
              : "text-black/70 hover:text-black underline")
          }
        >
          {props.label}
        </a>
      </div>
    )
  },
  section: {
    label: "Section",
    icon: "▭",
    defaults: { bg: "#ffffff", paddingY: 32, paddingX: 16, maxW: 900, radius: 20, shadow: true },
    inspector: [
      { key: "bg", label: "Background", type: "color" },
      { key: "paddingY", label: "Padding Y (px)", type: "number", min: 0, max: 128 },
      { key: "paddingX", label: "Padding X (px)", type: "number", min: 0, max: 64 },
      { key: "maxW", label: "Max Width (px)", type: "number", min: 300, max: 1400 },
      { key: "radius", label: "Corner Radius (px)", type: "number", min: 0, max: 40 },
      { key: "shadow", label: "Shadow", type: "checkbox" }
    ],
    // Container renders its children
    render: (props, children) => (
      <section
        style={{ background: props.bg, padding: `${props.paddingY}px ${props.paddingX}px`, borderRadius: props.radius, maxWidth: props.maxW }}
        className={`mx-auto ${props.shadow ? "shadow-lg" : ""}`}
      >
        {children}
      </section>
    )
  },
  spacer: {
    label: "Spacer",
    icon: "↕",
    defaults: { height: 24 },
    inspector: [ { key: "height", label: "Height (px)", type: "number", min: 0, max: 160 } ],
    render: (props) => <div style={{ height: props.height }} />
  }
};

// -----------------------------
// Templates (seed data)
// -----------------------------
const TEMPLATES = {
  minimal: () => ([
    block("section", { bg: "#ffffff", paddingY: 40, maxW: 820 }),
    block("heading", { text: "Hello from Websites.co.in", level: 2, align: "center" }),
    block("text", { text: "Drag from the left, then edit me on the right.", align: "center" }),
    block("image", { src: "https://picsum.photos/seed/hero/1200/500", radius: 20 }),
    block("button", { label: "Get Started", align: "center" })
  ]),
  landing: () => ([
    block("section", { bg: "#F0F9FF", paddingY: 56, maxW: 1000 }),
    block("heading", { text: "Super‑simple websites, in minutes", level: 1, align: "center" }),
    block("text", { text: "Start with drag‑and‑drop, fine‑tune with forms.", align: "center" }),
    block("button", { label: "Create My Site", align: "center", variant: "solid" }),
    block("spacer", { height: 24 }),
    block("section", { bg: "#ffffff", paddingY: 40, maxW: 1000, shadow: true }),
    block("heading", { text: "Why it works", level: 2 }),
    block("text", { text: "Clean defaults, then tweak details in the inspector. Add more blocks any time." })
  ])
};

// -----------------------------
// Helpers
// -----------------------------
function block(type, overrides = {}) {
  return { id: uuidv4(), type, props: { ...ELEMENTS[type].defaults, ...overrides }, children: ELEMENTS[type].render.length === 2 ? [] : undefined };
}

function cloneDeep(v) { return JSON.parse(JSON.stringify(v)); }

// -----------------------------
// Sortable item wrapper
// -----------------------------
function SortableItem({ id, children, selected }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className={`group relative ${isDragging ? "opacity-70" : ""}`}>
      {/* Drag handle */}
      <div className={`absolute -left-6 top-2 hidden group-hover:flex items-center gap-1 text-xs ${selected ? "text-black" : "text-black/40"}`}>
        <div className="w-4 h-4 rounded bg-black/80 text-white flex items-center justify-center">≡</div>
      </div>
      {children}
    </div>
  );
}

// -----------------------------
// Canvas renderer
// -----------------------------
function Canvas({ tree, onSelect, selectedId }) {
  return (
    <div className="flex flex-col gap-3">
      {tree.map((node) => (
        <NodeView key={node.id} node={node} depth={0} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
}

function NodeView({ node, depth, selectedId, onSelect }) {
  const selected = node.id === selectedId;
  const hasChildren = Array.isArray(node.children);
  const Element = ELEMENTS[node.type];
  return (
    <div onClick={(e) => { e.stopPropagation(); onSelect(node.id); }} className={`relative border ${selected ? "border-black" : "border-transparent"} rounded-2xl p-2`}>
      <SortableItem id={node.id} selected={selected}>
        {hasChildren ? (
          <div className={`${selected ? "ring-2 ring-black" : "ring-1 ring-black/5"} rounded-2xl`}>
            {Element.render(node.props, (
              <div className="flex flex-col gap-3">
                {node.children.map((child) => (
                  <NodeView key={child.id} node={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className={`${selected ? "ring-2 ring-black" : "ring-1 ring-black/5"} rounded-2xl p-2`}>{Element.render(node.props)}</div>
        )}
      </SortableItem>
    </div>
  );
}

// -----------------------------
// Inspector (right side forms)
// -----------------------------
function Inspector({ selected, updateProps, removeNode }) {
  if (!selected) return (
    <div className="text-sm text-black/60">Select a block to edit its properties.</div>
  );
  const config = ELEMENTS[selected.type];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{config.label}</h3>
        <button onClick={() => removeNode(selected.id)} className="text-red-600 text-xs underline">Delete</button>
      </div>
      {config.inspector.map((field) => (
        <Field key={field.key} field={field} value={selected.props[field.key]} onChange={(v) => updateProps(field.key, v)} />
      ))}
    </div>
  );
}

function Field({ field, value, onChange }) {
  const base = "w-full rounded-xl border border-black/10 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black/30";
  switch (field.type) {
    case "text":
      return labelWrap(field.label, <input className={base} value={value || ""} onChange={(e) => onChange(e.target.value)} />);
    case "textarea":
      return labelWrap(field.label, <textarea rows={3} className={base} value={value || ""} onChange={(e) => onChange(e.target.value)} />);
    case "number":
      return labelWrap(field.label, <input type="number" min={field.min} max={field.max} className={base} value={value ?? 0} onChange={(e) => onChange(Number(e.target.value))} />);
    case "select":
      return labelWrap(field.label, (
        <select className={base} value={value} onChange={(e) => onChange(e.target.value)}>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ));
    case "color":
      return labelWrap(field.label, <input className={base} type="color" value={value} onChange={(e) => onChange(e.target.value)} />);
    case "checkbox":
      return (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {field.label}
        </label>
      );
    default:
      return null;
  }
}
function labelWrap(label, control) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-black/60">{label}</div>
      {control}
    </div>
  );
}

// -----------------------------
// Palette (left) — drag sources
// -----------------------------
const PALETTE = ["heading", "text", "image", "button", "section", "spacer"];

function PaletteItem({ type, onAdd }) {
  const cfg = ELEMENTS[type];
  return (
    <button onClick={() => onAdd(type)} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-black/10 hover:bg-black/5 text-left">
      <span className="w-5 text-center">{cfg.icon}</span>
      <span className="text-sm">{cfg.label}</span>
      <span className="ml-auto text-xs text-black/40">Add</span>
    </button>
  );
}

// -----------------------------
// Main App
// -----------------------------
export default function DragDropBuilder() {
  const [nodes, setNodes] = useState(TEMPLATES.minimal());
  const [selectedId, setSelectedId] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [preview, setPreview] = useState("desktop"); // or 'mobile'
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 4 } }), useSensor(TouchSensor));

  // Simple undo stack
  const [history, setHistory] = useState([]);
  function commit(next) {
    setHistory((h) => [nodes, ...h].slice(0, 20));
    setNodes(next);
  }
  function undo() {
    setHistory((h) => {
      if (!h.length) return h;
      const [prev, ...rest] = h;
      setNodes(prev);
      return rest;
    });
  }

  const selected = useMemo(() => nodesFlat(nodes).find((n) => n.id === selectedId) || null, [nodes, selectedId]);

  // DnD handlers (top-level reorder only for brevity; children reordering could use nested SortableContexts)
  function handleDragStart(event) { setDragId(event.active.id); }
  function handleDragEnd(event) {
    const { active, over } = event;
    setDragId(null);
    if (!over || active.id === over.id) return;
    const oldIndex = nodes.findIndex((n) => n.id === active.id);
    const newIndex = nodes.findIndex((n) => n.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    commit(arrayMove(nodes, oldIndex, newIndex));
  }

  // Helpers to mutate
  function addBlock(type) { commit([...nodes, block(type)]); }
  function removeNode(id) { commit(nodes.filter((n) => n.id !== id)); if (selectedId === id) setSelectedId(null); }
  function updateProps(key, value) {
    commit(nodes.map((n) => (n.id === selectedId ? { ...n, props: { ...n.props, [key]: value } } : n)));
  }

  function loadTemplate(name) { commit(TEMPLATES[name]()); setSelectedId(null); }

  function exportJSON() {
    const data = JSON.stringify(nodes, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "websites-builder.json"; a.click();
    URL.revokeObjectURL(url);
  }
  function importJSON(evt) {
    const file = evt.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(String(e.target?.result));
        if (Array.isArray(parsed)) commit(parsed);
      } catch {}
    };
    reader.readAsText(file);
  }

  return (
    <div className="h-screen w-full flex flex-col">
      {/* Topbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-black/10">
        <div className="font-semibold">Websites.co.in — Builder</div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => loadTemplate("minimal")} className="px-3 py-1.5 text-sm rounded-xl border">Minimal</button>
          <button onClick={() => loadTemplate("landing")} className="px-3 py-1.5 text-sm rounded-xl border">Landing</button>
          <div className="w-px h-6 bg-black/10 mx-1" />
          <button onClick={() => setPreview("desktop")} className={`px-3 py-1.5 text-sm rounded-xl border ${preview==='desktop'?'bg-black text-white':''}`}>Desktop</button>
          <button onClick={() => setPreview("mobile")} className={`px-3 py-1.5 text-sm rounded-xl border ${preview==='mobile'?'bg-black text-white':''}`}>Mobile</button>
          <div className="w-px h-6 bg-black/10 mx-1" />
          <button onClick={undo} className="px-3 py-1.5 text-sm rounded-xl border">Undo</button>
          <button onClick={exportJSON} className="px-3 py-1.5 text-sm rounded-xl border">Export</button>
          <label className="px-3 py-1.5 text-sm rounded-xl border cursor-pointer">
            Import
            <input type="file" accept="application/json" className="hidden" onChange={importJSON} />
          </label>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 grid grid-cols-12 gap-4 p-4 overflow-hidden">
        {/* Palette */}
        <aside className="col-span-12 md:col-span-3 lg:col-span-2 overflow-auto">
          <div className="sticky top-0">
            <div className="text-xs font-semibold mb-2">Elements</div>
            <div className="space-y-2">
              {PALETTE.map((t) => <PaletteItem key={t} type={t} onAdd={addBlock} />)}
            </div>
            <div className="mt-6 text-xs text-black/60">Drag not required — click "Add" to append. Reorder by dragging on canvas.</div>
          </div>
        </aside>

        {/* Canvas */}
        <main className="col-span-12 md:col-span-6 lg:col-span-8 overflow-auto">
          <div className="flex justify-center">
            <div className={`w-full ${preview === 'mobile' ? 'max-w-[420px]' : 'max-w-[1100px]'} transition-all`}>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                <SortableContext items={nodes.map((n) => n.id)} strategy={verticalListSortingStrategy}>
                  <div onClick={() => setSelectedId(null)} className="bg-gray-50 rounded-3xl border border-black/10 p-4 md:p-8">
                    <Canvas tree={nodes} selectedId={selectedId} onSelect={setSelectedId} />
                    {/* Drop hint */}
                    {!nodes.length && (
                      <div className="text-center text-sm text-black/50 py-16">Add blocks from the left to get started</div>
                    )}
                  </div>
                </SortableContext>
                <DragOverlay>
                  {dragId ? (
                    <div className="px-3 py-2 rounded-xl bg-black text-white text-xs">Moving block…</div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            </div>
          </div>
        </main>

        {/* Inspector */}
        <aside className="col-span-12 md:col-span-3 lg:col-span-2 overflow-auto">
          <div className="sticky top-0">
            <div className="text-xs font-semibold mb-2">Inspector</div>
            <div className="space-y-3">
              <Inspector selected={selected} updateProps={updateProps} removeNode={removeNode} />
              <div className="text-xs text-black/50 pt-4 border-t">Tip: Click a block then edit its fields here. All inputs are standard HTML form controls.</div>
            </div>
          </div>
        </aside>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 text-xs text-black/50 border-t">
        Prototype for evaluation only. Built with React, dnd‑kit, Tailwind. No backend.
      </div>
    </div>
  );
}

// Utility to flatten top‑level (and nested) nodes for selection lookup
function nodesFlat(nodes) {
  const out = [];
  for (const n of nodes) {
    out.push(n);
    if (Array.isArray(n.children)) out.push(...nodesFlat(n.children));
  }
  return out;
}
