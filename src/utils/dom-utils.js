export function getCurrentResultContainer(resultsContainer) {
    var resultContainer = resultsContainer.children[resultsContainer.children.length - 1];

    //if the last child is not a cc-result-item, create one
    if(resultContainer?.classList.contains('cc-result-item')) {
        return resultContainer;
    } else {
        resultContainer = document.createElement('div');
        resultContainer.classList.add('cc-result-item');
        resultsContainer.appendChild(resultContainer);
    }
    return resultContainer;
}

export function updateContainerState(container, newState) {
    // Add transitioning class before changing states
    container.classList.add('transitioning');

    // Remove previous states after a brief delay
    setTimeout(() => {
        container.classList.remove('waiting-input', 'has-error', 'tool-running', 'success', 'rainbow');
        if (newState) {
            container.classList.add(newState);
        }
        // Remove transitioning class to start new animation
        container.classList.remove('transitioning');
    }, 150);
}

export function displayError(container, error, resultsContainer) {
    container.classList.remove('processing', 'tool-running');
    container.classList.add('has-error');
    let errorMessage = error.message || error.content || 'Unknown error';
    if(errorMessage.length > 0) {
        let ccError = document.createElement('div');
        ccError.classList.add('cc-error');
        ccError.textContent = errorMessage;
        resultsContainer.appendChild(ccError);
    }
}

export function createUserMessage(value, resultsContainer) {
    const userElement = document.createElement('div');
    userElement.classList.add('cc-user-message');
    userElement.textContent = value;
    resultsContainer.appendChild(userElement);
    resultsContainer.scrollTop = resultsContainer.scrollHeight;
} 