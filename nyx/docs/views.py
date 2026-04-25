from django.contrib.auth.mixins import LoginRequiredMixin
from django.http import Http404
from django.shortcuts import render
from django.views import View

import frontmatter
import markdown

from .index import DOC_INDEX, can_access, visible_for

_MD_EXTENSIONS = ["fenced_code", "tables", "toc"]


class DocView(LoginRequiredMixin, View):
    def get(self, request, doc_path):
        entry = DOC_INDEX.get(doc_path)
        if not entry or not can_access(request.user, entry):
            raise Http404

        with open(entry["path"], encoding="utf-8") as f:
            post = frontmatter.load(f)

        content = markdown.markdown(post.content, extensions=_MD_EXTENSIONS)
        base_template = "layout/fragment.html" if request.htmx else "layout/base.html"

        return render(request, "docs/doc.html", {
            "entry": entry,
            "content": content,
            "base_template": base_template,
        })


class DocSearchView(LoginRequiredMixin, View):
    def get(self, request):
        q = request.GET.get("q", "").strip().lower()
        results = []

        if q:
            for slug, entry in visible_for(request.user).items():
                if (
                    q in entry["title"].lower()
                    or q in entry["excerpt"].lower()
                    or any(q in tag.lower() for tag in entry["tags"])
                    or (entry["app_required"] and q in entry["app_required"].lower())
                ):
                    results.append({"slug": slug, **entry})

        base_template = "layout/fragment.html" if request.htmx else "layout/base.html"

        return render(request, "docs/search.html", {
            "q": q,
            "results": results,
            "base_template": base_template,
        })
