import jupyterlab_pygments
from jupyterlab_pygments import JupyterStyle

from pygments.lexers import PythonLexer
from pygments.token import Text, String, Operator, Name

class CustomPythonLexer(PythonLexer):
    tokens = PythonLexer.tokens.copy()
    tokens['root'].insert(0, (r'\$[a-zA-Z0-9_]+', Name))  # Treat sequences of numbers and letters after $ as Text
    # tokens['root'].insert(1, (r'\$', Text))  # Treat $ as text

# Use JupyterLab Pygments style
pygments_style = 'jupyterlab_pygments.JupyterStyle'

def setup(app):
    app.add_lexer('ipython3', CustomPythonLexer())