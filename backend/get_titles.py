import pickle
import json
import sys
import os

def main():
    try:
        print(f"Current working directory: {os.getcwd()}", file=sys.stderr)
        print(f"Files in directory: {os.listdir('.')}", file=sys.stderr)
        
        if not os.path.exists("movies_preprocessed.pkl"):
            print("Error: movies_preprocessed.pkl not found", file=sys.stderr)
            sys.exit(1)
        
        print("Loading movies_preprocessed.pkl...", file=sys.stderr)
        
        with open("movies_preprocessed.pkl", "rb") as f:
            data = pickle.load(f)
        
        print(f"Loaded data type: {type(data)}", file=sys.stderr)
        print(f"Data shape: {data.shape if hasattr(data, 'shape') else 'No shape attribute'}", file=sys.stderr)
        
        if hasattr(data, 'title'):
            titles = data['title'].tolist()
        else:
            print(f"Data columns: {data.columns.tolist() if hasattr(data, 'columns') else 'No columns'}", file=sys.stderr)
            titles = []
        
        print(f"Extracted {len(titles)} movie titles", file=sys.stderr)
        
        titles.sort()
        
        print(json.dumps(titles))
        
    except FileNotFoundError as e:
        print(f"Error: File not found - {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"An error occurred: {e}", file=sys.stderr)
        print(f"Error type: {type(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
