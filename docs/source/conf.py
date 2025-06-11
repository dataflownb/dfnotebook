# Configuration file for the Sphinx documentation builder.
#
# For the full list of built-in configuration values, see the documentation:
# https://www.sphinx-doc.org/en/master/usage/configuration.html

# -- Project information -----------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#project-information

project = 'Dataflow Notebooks'
copyright = '2024, Dataflow Notebooks Team'
author = 'Dataflow Notebooks Team'
#release = '0.4.0-alpha.2'

# -- General configuration ---------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#general-configuration

#reset the path
import sys
import os
sys.path.insert(0, os.path.abspath('.'))

from custom_lexer import CustomPythonLexer

def setup(app): #add the lexer
    app.add_lexer('custom', CustomPythonLexer())

# Use JupyterLab Pygments style
pygments_style = 'jupyterlab_pygments.JupyterStyle'

extensions = ['nbsphinx',
              'sphinx.ext.autodoc',
              'sphinx.ext.napoleon',
              'sphinx.ext.viewcode']

nbsphinx_execute = 'never'

templates_path = ['_templates']
exclude_patterns = []



# -- Options for HTML output -------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#options-for-html-output

html_theme = 'pydata_sphinx_theme'
html_static_path = ['_static']


# html_theme_options = {
#     "secondary_sidebar_items": {
#         "path/to/page": [],
#     },
# }

html_sidebars = {
  "**": []
  
}


# Create rules to show errors as they are shown in notebooks
nbsphinx_prolog = """
.. raw:: html
    
    # <style>
    # .highlighted-note {
    #     background-color: DarkSlateGray;
    #     color: white;
    #     padding: 5px;
    #     border-radius: 4px;
    # }
    # </style>

    <script>
        $(document).ready(function() {
            $("span.ansi-red-intense-fg.ansi-bold").each(function() {
                $(this).closest("div.highlight").parent().css("background-color", "#fdd");
            });

            // Scroll to the element with ID based on URL hash if present
            if (window.location.hash) {
                var hash = window.location.hash.substring(1);
                var element = document.getElementById(hash);
                if (element) {
                    element.scrollIntoView();
                }
            }

            # // Highlight <p> elements containing the text "Dataflow notes"
            # $("p").filter(function() {
            #     return $(this).text().indexOf("Dataflow notes") >= 0;
            # }).addClass("highlighted-note");
        });
    </script>
"""