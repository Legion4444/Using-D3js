// Fragile, hacky script that finds exercises in chapters, extracts
// their starting code, and collects it into a big JSON object
// together with the solution code.

const PJSON = require("./pseudo_json")
let fs = require("fs");

let output = [], failed = false;

let allSolutions = fs.readdirSync("code/solutions/").filter(file => !/^(\.|2[012])/.test(file));

for (let file of fs.readdirSync(".").sort()) {
  let match = /^((\d+).*).md$/.exec(file), chapNum = match && match[2];
  if (!match || chapNum == 22) continue;
  let text = fs.readFileSync(file, "utf8");
  let meta = (/{{meta (.*)}}/.exec(text) || {1: "{}"})[1]
  let includes = /\bload_files: (\[.*?\])/.exec(meta)
  if (includes) includes = JSON.parse(includes[1]);

  //console.log("filename: " + text.match(/(?:^|\n)# (.*?)\n/)[0]);

  let chapter = {number: +chapNum,
                 id: match[1],
                 title: text.match(/(?:^|\n)# (.*?)\n/)[1],
                 start_code: getStartCode(text, includes),
                 exercises: [],
                 include: includes};
  let zip = chapterZipFile(text, chapter);
  let extraLinks = meta.match(/\bcode_links: (\[.*?\])/);
  if (extraLinks) extraLinks = JSON.parse(extraLinks[1]);
  if (extraLinks || zip)
    chapter.links = (zip ? [zip] : []).concat(extraLinks || []);

  let exerciseSection = text.indexOf("\n## Exercises\n");
  let exerciseBlock = exerciseSection >= 0 ? text.slice(exerciseSection) : "";
  let header = /\n### (.*?)\n/g, nextHeader = /\n##+ \w/g;
  let num = 1;
  while (match = header.exec(exerciseBlock)) {
    nextHeader.lastIndex = header.lastIndex
    let foundNext = nextHeader.exec(exerciseBlock)
    let nextsection = foundNext ? foundNext.index : -1
    for (let pos = header.lastIndex;;) {
      let ifdef = exerciseBlock.indexOf("{{if interactive", pos);
      if (ifdef == -1 || nextsection > 0 && nextsection < ifdef) break;
      let indef = exerciseBlock.slice(pos = ifdef + 15, exerciseBlock.indexOf("if}}", ifdef));
      let sourceBlock = indef.match(/```(.*)\n([^]+?)\n```/);
      if (!sourceBlock || sourceBlock[1].indexOf("null") > -1) continue;
      let type = sourceBlock[1].indexOf("html") > -1 ? "html" : "js";
      let file = chapNum + "_" + num + "_" + match[1].toLowerCase().replace(/[^\-\s\w]/g, "").replace(/\s/g, "_") + "." + type;
      let solution, extra
      try {
        solution = fs.readFileSync("code/solutions/" + file, "utf8");
        extra = /^\s*<!doctype html>\s*(<base .*\n(<script src=.*\n)*)?/.exec(solution);
        if (extra) solution = solution.slice(extra[0].length);
        allSolutions.splice(allSolutions.indexOf(file), 1);
      } catch(e) {
        console.error("File ", file, " does not exist.", e);
        failed = true;
      }
      if (sourceBlock) {
        chapter.exercises.push({
          name: match[1],
          file: "code/solutions/" + file,
          number: num,
          type: type,
          code: type == "html" ? prepareHTML(sourceBlock[2], includes) : sourceBlock[2],
          solution: type == "html" ? prepareHTML(solution.trim(), includes) : solution.trim()
        });
        break;
      }
    }
    ++num;
  }

  output.push(chapter);
}

if (allSolutions.length) {
  console.error("Solution files " + allSolutions + " were not used.");
  failed = true;
}

if (!failed)
  console.log("var chapterData = " + JSON.stringify(output, null, 2) + ";");
else
  process.exit(1);

function prepareHTML(code, include) {
  return "<!doctype html>\n" + (include || []).map(s => "<script src=\"" + s + "\"></script>\n").join("") + "\n" + code;
}

function guessType(code) {
  return /^[\s\w\n:]*</.test(code) ? "html" : "js";
}

function getStartCode(text, includes) {
  let found = /\n```(.*?\bstartCode:.*)\n([^]*?\n)```/.exec(text);
  if (!found) return ""

  let snippet = found[2].replace(/(\n|^)\s*\/\/ →.*\n/g, "$1");
  let directive = String(PJSON.parse(found[1]).startCode), m;
  if (m = directive.match(/top_lines:\s*(\d+)/))
    snippet = snippet.split("\n").slice(0, Number(m[1])).join("\n") + "\n";
  if (m = directive.match(/bottom_lines:\s*(\d+)/)) {
    let lines = snippet.trimRight().split("\n");
    snippet = lines.slice(lines.length - Number(m[1])).join("\n") + "\n";
  }
  if (guessType(snippet) == "html")
    return prepareHTML(snippet, includes);
  else
    return snippet;
}

function chapterZipFile(text, chapter) {
  let spec = text.match(/\n:zip: (\S+)(?: include=(.*))?/);
  if (!spec) return null;
  if (!chapter.start_code) throw new Error("zip but no start code");
  let name = "code/chapter/" + chapter.id + ".zip";
  let files = (chapter.include || []).concat(spec[2] ? JSON.parse(spec[2]) : []);
  let exists = fs.existsSync(name) && fs.statSync(name).mtime;
  if (exists && files.every(file => fs.statSync("html/" + file).mtime < exists))
    return name;

  let zip = new (require("jszip"));
  for (let file of files) {
    zip.file(chapter.id + "/" + file, fs.readFileSync("html/" + file));
  }
  if (spec[1].indexOf("html") != -1) {
    let html = chapter.start_code;
    if (guessType(html) != "html")
      html = prepareHTML("<body><script>\n" + html.trim() + "\n</script></body>", chapter.include);
    zip.file(chapter.id + "/index.html", html);
  }
  if (spec[1].indexOf("node") != -1) {
    zip.file(chapter.id + "/code/load.js", fs.readFileSync("code/load.js", "utf8"));
    let js = chapter.start_code;
    if (chapter.include) js = "// load dependencies\nrequire(\"./code/load\")(" + chapter.include.map(JSON.stringify).join(", ") + ");\n\n" + js;
    zip.file(chapter.id + "/run_with_node.js", js);
  }
  fs.writeFileSync(name, zip.generate({type: "nodebuffer"}));
  return name;
}
