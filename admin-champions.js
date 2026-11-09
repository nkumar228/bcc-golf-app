// Admin: Hall of Champions tab. One row per season; photos upload to the public "champions" bucket.
(() => {
  const A = window.BCCAdmin, { sb, $, esc, toast, check } = A;
  const thumb = src => src ? `<a href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(src)}" alt="" style="width:64px;height:48px;object-fit:cover;border-radius:6px;display:block"></a>` : '<span class="note">none</span>';
  const photoCell = (c, k) => `<td><div class="row" style="gap:6px;flex-wrap:nowrap">${thumb(c[k])}
    <label class="btn secondary" style="padding:5px 9px;font-size:13px;white-space:nowrap">${c[k] ? "Replace" : "Add"}<input type="file" accept="image/*" data-up="${k}" hidden></label>
    ${c[k] ? `<button class="btn secondary" type="button" data-rm="${k}" style="padding:5px 9px;font-size:13px">Remove</button>` : ""}</div></td>`;

  // Shrink a photo to at most 1200px on its long side before upload
  const shrink = file => new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const s = Math.min(1, 1200 / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); c.toBlob(b => b ? res(b) : rej(new Error("Couldn't read that photo")), "image/jpeg", 0.82); };
    img.onerror = () => rej(new Error("Couldn't read that photo")); img.src = url;
  });

  // Shared with the Cup history: shrink, upload to the "champions" bucket, return the public URL
  A.uploadPhoto = async (file, name) => {
    const blob = await shrink(file), path = `${name}-${Date.now()}.jpg`;
    const { error } = await sb.storage.from("champions").upload(path, blob, { contentType: "image/jpeg" });
    if (error) throw error;
    return sb.storage.from("champions").getPublicUrl(path).data.publicUrl;
  };

  async function loadChamps() {
    const { data } = await sb.from("champions").select("*").order("year", { ascending: false });
    const rows = data || [];
    $("champTable").innerHTML = `<thead><tr><th>Year</th><th>League champion</th><th>Photo</th><th>Team name</th><th>Team players</th><th>Photo</th><th>Notes</th><th></th></tr></thead><tbody>` +
      (rows.map(c => `<tr data-id="${c.id}" data-year="${c.year}"><td><input class="w-num" type="number" data-c="year" value="${c.year}"></td>
        <td><input data-c="league_champion" value="${esc(c.league_champion || "")}" style="width:140px"></td>${photoCell(c, "league_photo")}
        <td><input data-c="team_name" value="${esc(c.team_name || "")}" style="width:170px"></td>
        <td><input data-c="team_players" value="${esc(c.team_players || "")}" placeholder="Name and Name" style="width:210px"></td>${photoCell(c, "team_photo")}
        <td><input data-c="notes" value="${esc(c.notes || "")}" style="width:160px"></td>
        <td><button class="btn danger" type="button" data-cdel>Delete</button></td></tr>`).join("") || '<tr><td colspan="8" class="note">No years yet.</td></tr>') + "</tbody>";
    const T = $("champTable"), idOf = el => +el.closest("tr").dataset.id;
    T.querySelectorAll("[data-c]").forEach(el => el.onchange = async () => {
      const k = el.dataset.c, v = k === "year" ? (el.value === "" ? null : +el.value) : (el.value.trim() || null);
      const { error } = await sb.from("champions").update({ [k]: v }).eq("id", idOf(el));
      if (!check(error) && k === "year") loadChamps();
    });
    T.querySelectorAll("[data-up]").forEach(el => el.onchange = async () => {
      const f = el.files[0]; if (!f) return;
      try {
        toast("Uploading…");
        const blob = await shrink(f), tr = el.closest("tr"), path = `${tr.dataset.year}-${el.dataset.up.replace("_photo", "")}-${Date.now()}.jpg`;
        const { error } = await sb.storage.from("champions").upload(path, blob, { contentType: "image/jpeg" });
        if (error) throw error;
        const url = sb.storage.from("champions").getPublicUrl(path).data.publicUrl;
        const r = await sb.from("champions").update({ [el.dataset.up]: url }).eq("id", idOf(el));
        if (check(r.error, "Photo saved")) loadChamps();
      } catch (e) { toast("Couldn't upload: " + (e.message || e), true); }
    });
    T.querySelectorAll("[data-rm]").forEach(b => b.onclick = async () => {
      if (!confirm("Take this photo off the page?")) return;
      const { error } = await sb.from("champions").update({ [b.dataset.rm]: null }).eq("id", idOf(b));
      if (check(error, "Photo removed")) loadChamps();
    });
    T.querySelectorAll("[data-cdel]").forEach(b => b.onclick = async () => {
      if (!confirm(`Delete ${b.closest("tr").dataset.year} from the Hall of Champions?`)) return;
      const { error } = await sb.from("champions").delete().eq("id", idOf(b)); if (check(error, "Deleted")) loadChamps();
    });
  }
  $("champAdd").onclick = async () => {
    const { data } = await sb.from("champions").select("year").order("year", { ascending: false }).limit(1);
    const y = data && data[0] ? data[0].year + 1 : new Date().getFullYear();
    const { error } = await sb.from("champions").insert({ year: y });
    if (check(error, `${y} added`)) loadChamps();
  };

  const prev = A.onLoad;
  A.onLoad = () => { if (prev) prev(); loadChamps(); };
})();
