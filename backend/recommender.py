import sys
import pickle
import pandas as pd

def recommend_movie_ids(movie_title):
    try:
        with open("movies_preprocessed.pkl", "rb") as f:
            data = pickle.load(f)
        
        with open("similarity.pkl", "rb") as f:
            similarity = pickle.load(f)
        
        movie_title_lower = movie_title.lower()
        matching_indices = data[data['title'].str.lower() == movie_title_lower].index
        
        if len(matching_indices) == 0:
            return []
        
        movie_index = matching_indices[0]
        
        distances = similarity[movie_index]
        
        movies_list = sorted(list(enumerate(distances)), key=lambda x: x[1], reverse=True)[1:6]
        
        recommended_ids = []
        for i, similarity_score in movies_list:
            movie_id = data.iloc[i]['movie_id']
            recommended_ids.append(str(movie_id))  
        
        return recommended_ids
        
    except FileNotFoundError as e:
        print(f"Error: Model files not found - {e}", file=sys.stderr)
        return []
    except Exception as e:
        print(f"An error occurred: {e}", file=sys.stderr)
        return []

if __name__ == "__main__":
    if len(sys.argv) > 1:
        title = sys.argv[1]
        ids = recommend_movie_ids(title)
        if ids:
            print(','.join(ids))
        else:
            print("")  
    else:
        print("Error: No movie title provided.", file=sys.stderr)
        sys.exit(1)
